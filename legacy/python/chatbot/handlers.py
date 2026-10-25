"""Triagem privada e respostas autorizadas a partir dos grupos da equipe."""

import logging

from telegram import ReplyKeyboardMarkup, ReplyKeyboardRemove, Update
from telegram.error import TelegramError
from telegram.ext import ContextTypes

from .config import Settings
from .departments import DEPARTMENTS, menu_text, select_department
from .storage import Ticket, TicketStore

logger = logging.getLogger(__name__)
MAX_DESCRIPTION = 2500


def protocol_id(value: str) -> int | None:
    """Valide antes de converter ou consultar um INTEGER do SQLite."""
    if not value.isascii() or not value.isdigit() or len(value) > 19:
        return None
    result = int(value)
    return result if 0 < result <= 2**63 - 1 else None


def menu_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [[f"{item.number} - {item.label} {item.emoji}"] for item in DEPARTMENTS],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


class SupportBot:
    def __init__(self, settings: Settings, store: TicketStore):
        self.settings = settings
        self.store = store

    async def menu(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        context.user_data.pop("request", None)
        await update.effective_message.reply_text(
            f"Olá! Bem-vindo ao atendimento de {self.settings.company_name}.\n\n"
            f"{menu_text()}\n\n"
            "Vou pedir nome, empresa e uma descrição para registrar seu atendimento. "
            "Não envie senhas, dados de cartão ou códigos de acesso.\n"
            "Use /menu para voltar ou /cancelar para cancelar.",
            reply_markup=menu_keyboard(),
        )

    async def cancel(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        context.user_data.pop("request", None)
        await update.effective_message.reply_text(
            "Coleta cancelada. Nenhuma nova solicitação foi registrada.\n\n" + menu_text(),
            reply_markup=menu_keyboard(),
        )

    async def message(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        message = update.effective_message
        text = (message.text or "").strip()
        if not text:
            await message.reply_text("Envie uma mensagem de texto para continuar ou use /menu.")
            return

        draft = context.user_data.get("request")
        if draft is None:
            department = select_department(text)
            if department is None:
                await message.reply_text(
                    "Escolha uma das opções abaixo ou toque em um dos botões.\n\n" + menu_text(),
                    reply_markup=menu_keyboard(),
                )
                return
            context.user_data["request"] = {"department": department.key, "stage": "name"}
            await message.reply_text(
                f"Você escolheu {department.label}.\nQual é o seu nome?",
                reply_markup=ReplyKeyboardRemove(),
            )
            return

        if draft["stage"] == "name":
            if len(text) > 100:
                await message.reply_text("Informe um nome com até 100 caracteres.")
                return
            draft.update(customer_name=text, stage="company")
            await message.reply_text(
                "Qual é o nome da sua empresa? Se não se aplica, envie um hífen (-)."
            )
            return

        if draft["stage"] == "company":
            if len(text) > 150:
                await message.reply_text("Informe uma empresa com até 150 caracteres.")
                return
            draft.update(company="Não informado" if text == "-" else text, stage="description")
            await message.reply_text(
                "Descreva o que você precisa em uma única mensagem de texto "
                f"(até {MAX_DESCRIPTION} caracteres)."
            )
            return

        if len(text) > MAX_DESCRIPTION:
            await message.reply_text(f"Resuma a solicitação em até {MAX_DESCRIPTION} caracteres.")
            return
        user = update.effective_user
        ticket = self.store.create_ticket(
            chat_id=update.effective_chat.id,
            username=user.username,
            department=draft["department"],
            customer_name=draft["customer_name"],
            company=draft["company"],
            description=text,
        )
        # Retire o rascunho após salvar, mesmo se o Telegram falhar em seguida.
        context.user_data.pop("request", None)
        delivered = await self.deliver(ticket, context)
        status = (
            "Sua solicitação foi encaminhada à equipe responsável. "
            "As respostas serão enviadas nesta conversa."
            if delivered else
            "Sua solicitação foi salva, mas o envio à equipe está indisponível. "
            f"Você pode tentar novamente com /reenviar {ticket.id}."
        )
        await message.reply_text(
            f"Protocolo #{ticket.id:06d}\n{status}\n\nUse /menu para um novo atendimento.",
            reply_markup=ReplyKeyboardRemove(),
        )

    async def deliver(self, ticket: Ticket, context: ContextTypes.DEFAULT_TYPE) -> bool:
        target = self.settings.team_chats.get(ticket.department)
        if target is None:
            return False
        department = next(item for item in DEPARTMENTS if item.key == ticket.department)
        username = f"@{ticket.username}" if ticket.username else "Sem nome de usuário"
        try:
            await context.bot.send_message(
                chat_id=target,
                text=(
                    f"Novo atendimento #{ticket.id:06d}\n"
                    f"Setor: {department.label}\n"
                    f"Nome: {ticket.customer_name}\n"
                    f"Empresa: {ticket.company}\n"
                    f"Telegram: {username}\n"
                    f"Data (UTC): {ticket.created_at}\n\n"
                    f"Solicitação:\n{ticket.description}\n\n"
                    f"Para responder ao cliente:\n/responder {ticket.id} Sua resposta"
                ),
            )
        except TelegramError as error:
            logger.warning("Envio do protocolo %s falhou (%s).", ticket.id, type(error).__name__)
            return False
        self.store.mark_delivered(ticket.id)
        return True

    async def retry(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        message = update.effective_message
        ticket_id = protocol_id(context.args[0]) if len(context.args) == 1 else None
        if ticket_id is None:
            await message.reply_text("Use /reenviar NUMERO_DO_PROTOCOLO.")
            return
        ticket = self.store.get_ticket(ticket_id)
        if ticket is None or ticket.chat_id != update.effective_chat.id:
            await message.reply_text("Protocolo não encontrado nesta conversa.")
            return
        if ticket.delivery_status == "delivered":
            await message.reply_text("Esse protocolo já foi encaminhado à equipe.")
            return
        delivered = await self.deliver(ticket, context)
        await message.reply_text(
            "Solicitação encaminhada à equipe. As respostas chegarão nesta conversa."
            if delivered else "O envio continua indisponível. Seu protocolo permanece salvo."
        )

    async def respond(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        message = update.effective_message
        chat_id = update.effective_chat.id
        # Autorização pelo grupo configurado para o setor, nunca pelo número do protocolo.
        if chat_id not in self.settings.team_chats.values():
            await message.reply_text("Este chat não está autorizado a responder atendimentos.")
            return
        ticket_id = protocol_id(context.args[0]) if len(context.args) >= 2 else None
        if ticket_id is None:
            await message.reply_text("Use /responder NUMERO_DO_PROTOCOLO Sua resposta.")
            return
        ticket = self.store.get_ticket(ticket_id)
        if ticket is None or self.settings.team_chats.get(ticket.department) != chat_id:
            await message.reply_text("Protocolo não encontrado para este grupo.")
            return
        response = " ".join(context.args[1:])
        if len(response) > 3500:
            await message.reply_text("Envie uma resposta com até 3500 caracteres.")
            return
        try:
            await context.bot.send_message(
                chat_id=ticket.chat_id,
                text=f"Resposta da equipe — protocolo #{ticket.id:06d}\n\n{response}\n\n"
                "Para outra solicitação, use /menu.",
            )
        except TelegramError as error:
            logger.warning("Resposta do protocolo %s falhou (%s).", ticket.id, type(error).__name__)
            await message.reply_text("Não foi possível enviar. O cliente pode ter bloqueado o bot.")
            return
        await message.reply_text(f"Resposta enviada ao cliente do protocolo #{ticket.id:06d}.")

    async def chat_id(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await update.effective_message.reply_text(f"ID deste chat: {update.effective_chat.id}")

    async def unknown_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await update.effective_message.reply_text(
            "Use /menu para escolher um setor, /cancelar para cancelar "
            "ou /reenviar NUMERO_DO_PROTOCOLO para tentar um envio pendente."
        )

    async def on_error(self, update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
        # Exceções de HTTP podem conter o token na URL. Não registre sua mensagem.
        logger.error("Falha no atendimento (%s).", type(context.error).__name__)
        if isinstance(update, Update) and update.effective_message:
            try:
                await update.effective_message.reply_text(
                    "Ocorreu uma falha. Tente novamente ou use /menu para reiniciar."
                )
            except TelegramError:
                pass
