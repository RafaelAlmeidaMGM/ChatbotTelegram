"""Construção da aplicação e execução por long polling (sem servidor web)."""

import logging

from dotenv import load_dotenv
from telegram import Update
from telegram.error import TelegramError
from telegram.ext import Application, CommandHandler, MessageHandler, filters

from .config import Settings
from .handlers import SupportBot
from .logging_config import configure_logging
from .storage import TicketStore


def build_application(settings: Settings) -> Application:
    service = SupportBot(settings, TicketStore(settings.database_path))
    app = Application.builder().token(settings.token).concurrent_updates(False).build()
    private = filters.ChatType.PRIVATE
    groups = filters.ChatType.GROUPS
    app.add_handler(CommandHandler(["start", "menu", "help", "ajuda"], service.menu, filters=private))
    app.add_handler(CommandHandler("cancelar", service.cancel, filters=private))
    app.add_handler(CommandHandler("reenviar", service.retry, filters=private))
    app.add_handler(CommandHandler("responder", service.respond, filters=groups))
    app.add_handler(CommandHandler("id", service.chat_id))
    app.add_handler(MessageHandler(private & filters.COMMAND, service.unknown_command))
    app.add_handler(MessageHandler(private & ~filters.COMMAND, service.message))
    app.add_error_handler(service.on_error)
    return app


def main() -> None:
    load_dotenv()
    try:
        settings = Settings.from_env()
    except ValueError as error:
        raise SystemExit(f"Configuração inválida: {error}") from None
    configure_logging(settings.token)
    if not settings.team_chats:
        logging.warning("Sem grupos configurados: os protocolos ficarão pendentes no banco local.")
    try:
        app = build_application(settings)
        # Preserva mensagens pendentes no Telegram ao reiniciar.
        app.run_polling(allowed_updates=[Update.MESSAGE], drop_pending_updates=False)
    except TelegramError as error:
        raise SystemExit(
            f"Não foi possível conectar ao Telegram ({type(error).__name__}). "
            "Verifique o token, a conexão e se há outra instância do bot em execução."
        ) from None


if __name__ == "__main__":
    main()
