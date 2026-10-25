"""Offline functional checks for triage, delivery and team authorization."""

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from telegram import Update
from telegram.error import Forbidden, NetworkError

from chatbot.app import build_application
from chatbot.config import Settings
from chatbot.departments import DEPARTMENTS
from chatbot.handlers import SupportBot
from chatbot.storage import TicketStore


class HandlerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.settings = Settings(
            token="123456:OFFLINE_TEST_ONLY",
            database_path=Path(self.directory.name) / "tickets.sqlite3",
            team_chats={department.key: -1000 - department.number for department in DEPARTMENTS},
            company_name="Empresa Exemplo",
        )
        self.store = TicketStore(self.settings.database_path)
        self.service = SupportBot(self.settings, self.store)
        self.context = SimpleNamespace(user_data={}, bot=SimpleNamespace(send_message=AsyncMock()), args=[])

    def update(self, text=None, chat_id=42, username="cliente"):
        return SimpleNamespace(
            effective_message=SimpleNamespace(text=text, reply_text=AsyncMock()),
            effective_chat=SimpleNamespace(id=chat_id),
            effective_user=SimpleNamespace(id=42, username=username),
        )

    async def say(self, text, chat_id=42):
        update = self.update(text, chat_id)
        await self.service.message(update, self.context)
        return update.effective_message

    def ticket(self, chat_id=42, department="suporte"):
        return self.store.create_ticket(
            chat_id=chat_id, username=None, department=department,
            customer_name="Cliente", company="Empresa", description="Preciso de ajuda",
        )

    async def test_menu_clears_draft_and_presents_both_sector_buttons(self):
        self.context.user_data["request"] = {"stage": "name"}
        update = self.update("/start")
        await self.service.menu(update, self.context)
        self.assertNotIn("request", self.context.user_data)
        call = update.effective_message.reply_text.await_args
        self.assertIn("Empresa Exemplo", call.args[0])
        buttons = call.kwargs["reply_markup"].keyboard
        self.assertEqual(len(buttons), 2)
        for department, row in zip(DEPARTMENTS, buttons):
            self.assertIn(department.label, row[0].text)

    async def test_complete_triage_routes_all_numeric_and_keyboard_options(self):
        for department in DEPARTMENTS:
            for choice in (str(department.number), f"{department.number} - {department.label} {department.emoji}"):
                with self.subTest(choice=choice):
                    self.context.bot.send_message.reset_mock()
                    name_prompt = await self.say(choice)
                    self.assertIn("nome", name_prompt.reply_text.await_args.args[0])
                    company_prompt = await self.say("Maria Silva")
                    self.assertIn("empresa", company_prompt.reply_text.await_args.args[0])
                    description_prompt = await self.say("Loja Exemplo")
                    self.assertIn("Descreva", description_prompt.reply_text.await_args.args[0])
                    confirmation = await self.say("Preciso configurar meu sistema.")
                    self.assertNotIn("request", self.context.user_data)
                    call = self.context.bot.send_message.await_args
                    self.assertEqual(call.kwargs["chat_id"], self.settings.team_chats[department.key])
                    self.assertIn(department.label, call.kwargs["text"])
                    self.assertIn("Maria Silva", call.kwargs["text"])
                    self.assertIn("Loja Exemplo", call.kwargs["text"])
                    self.assertIn("Preciso configurar meu sistema.", call.kwargs["text"])
                    self.assertIn("encaminhada", confirmation.reply_text.await_args.args[0])
        # Reopen the database to check durable records, rather than in-memory state.
        reopened = TicketStore(self.settings.database_path)
        for index in range(1, 2 * len(DEPARTMENTS) + 1):
            ticket = reopened.get_ticket(index)
            self.assertIsNotNone(ticket)
            self.assertEqual(ticket.department, DEPARTMENTS[(index - 1) // 2].key)
            self.assertEqual(ticket.delivery_status, "delivered")
        self.assertEqual(reopened.pending_tickets(), [])

    async def test_invalid_selection_and_attachment_do_not_create_requests(self):
        for text in ("3", "4", "5", "6", "7", "Implantação", "Comercial",
                     "Qualidade e Sucesso do Cliente", "Meios de Pagamento da Pro2Pay",
                     "2 - Implantação 🧑‍💻", "oi", "", None):
            with self.subTest(text=text):
                message = await self.say(text)
                message.reply_text.assert_awaited_once()
                self.assertNotIn("request", self.context.user_data)
        self.assertIsNone(self.store.get_ticket(1))
        self.context.bot.send_message.assert_not_awaited()

    async def test_limits_preserve_stage_and_optional_company(self):
        await self.say("1")
        await self.say("N" * 101)
        self.assertEqual(self.context.user_data["request"]["stage"], "name")
        await self.say("Maria")
        await self.say("E" * 151)
        self.assertEqual(self.context.user_data["request"]["stage"], "company")
        await self.say("-")
        await self.say("D" * 2501)
        self.assertEqual(self.context.user_data["request"]["stage"], "description")
        self.assertIsNone(self.store.get_ticket(1))
        await self.say("Preciso de ajuda")
        self.assertEqual(self.store.get_ticket(1).company, "Não informado")

    async def test_cancel_removes_draft_without_creating_ticket(self):
        await self.say("2")
        await self.say("Maria")
        update = self.update("/cancelar")
        await self.service.cancel(update, self.context)
        self.assertNotIn("request", self.context.user_data)
        self.assertIsNone(self.store.get_ticket(1))
        self.context.bot.send_message.assert_not_awaited()

    async def test_delivery_failure_persists_ticket_then_owner_can_retry(self):
        self.context.bot.send_message.side_effect = NetworkError("offline simulated failure")
        await self.say("2")
        await self.say("Maria")
        await self.say("Empresa")
        confirmation = await self.say("Preciso de uma segunda via do boleto")
        ticket = self.store.get_ticket(1)
        self.assertEqual(ticket.delivery_status, "pending")
        self.assertIn("/reenviar 1", confirmation.reply_text.await_args.args[0])
        self.assertNotIn("request", self.context.user_data)
        self.context.bot.send_message.reset_mock(side_effect=True)
        self.context.args = [str(ticket.id)]
        update = self.update("/reenviar 1")
        await self.service.retry(update, self.context)
        self.context.bot.send_message.assert_awaited_once()
        self.assertEqual(self.store.get_ticket(ticket.id).delivery_status, "delivered")
        self.assertEqual(self.store.pending_tickets(), [])

    async def test_unconfigured_sector_keeps_ticket_pending_without_claiming_delivery(self):
        self.service = SupportBot(
            Settings(token=self.settings.token, database_path=self.settings.database_path, team_chats={}),
            self.store,
        )
        await self.say("1")
        await self.say("Maria")
        await self.say("-")
        message = await self.say("Preciso de suporte")
        self.assertEqual(self.store.get_ticket(1).delivery_status, "pending")
        self.assertIn("indisponível", message.reply_text.await_args.args[0])
        self.context.bot.send_message.assert_not_awaited()

    async def test_retry_cannot_access_another_customers_ticket(self):
        ticket = self.ticket(chat_id=99)
        self.context.args = [str(ticket.id)]
        update = self.update("/reenviar 1", chat_id=42)
        await self.service.retry(update, self.context)
        self.context.bot.send_message.assert_not_awaited()
        self.assertIn("não encontrado", update.effective_message.reply_text.await_args.args[0])
        self.assertEqual(self.store.get_ticket(ticket.id).delivery_status, "pending")

    async def test_retry_does_not_duplicate_successfully_delivered_ticket(self):
        ticket = self.ticket()
        self.store.mark_delivered(ticket.id)
        self.context.args = [str(ticket.id)]
        update = self.update("/reenviar 1")
        await self.service.retry(update, self.context)
        self.context.bot.send_message.assert_not_awaited()
        self.assertIn("já foi encaminhado", update.effective_message.reply_text.await_args.args[0])

    async def test_retry_invalid_or_unknown_protocol_returns_guidance(self):
        for args in ([], ["abc"], ["1", "2"], ["999"], ["0"], ["-1"], ["9" * 30], ["١"], ["²"]):
            self.context.args = args
            update = self.update("/reenviar")
            await self.service.retry(update, self.context)
            update.effective_message.reply_text.assert_awaited_once()
        self.context.bot.send_message.assert_not_awaited()

    async def test_response_rejects_invalid_protocol_numbers_before_database_lookup(self):
        self.ticket()
        for value in ("0", "-1", "9" * 30, "١", "²"):
            with self.subTest(value=value):
                self.context.args = [value, "Resposta"]
                update = self.update("/responder", chat_id=-1001)
                await self.service.respond(update, self.context)
                self.assertIn("Use /responder", update.effective_message.reply_text.await_args.args[0])
        self.context.bot.send_message.assert_not_awaited()

    async def test_correct_sector_group_can_reply_to_customer(self):
        ticket = self.ticket()
        self.context.args = [str(ticket.id), "Olá,", "como", "posso", "ajudar?"]
        update = self.update("/responder 1 Olá, como posso ajudar?", chat_id=-1001)
        await self.service.respond(update, self.context)
        self.context.bot.send_message.assert_awaited_once()
        call = self.context.bot.send_message.await_args
        self.assertEqual(call.kwargs["chat_id"], 42)
        self.assertIn("Olá, como posso ajudar?", call.kwargs["text"])
        self.assertIn("#000001", call.kwargs["text"])
        self.assertIn("Resposta enviada", update.effective_message.reply_text.await_args.args[0])

    async def test_unauthorized_and_other_sector_groups_cannot_reply(self):
        ticket = self.ticket()
        self.context.args = [str(ticket.id), "Resposta"]
        for chat_id in (-9999, -1002, 42):
            with self.subTest(chat_id=chat_id):
                update = self.update("/responder 1 Resposta", chat_id=chat_id)
                await self.service.respond(update, self.context)
                update.effective_message.reply_text.assert_awaited_once()
        self.context.bot.send_message.assert_not_awaited()

    async def test_blocked_customer_does_not_get_false_success_confirmation(self):
        ticket = self.ticket()
        self.context.args = [str(ticket.id), "Resposta"]
        self.context.bot.send_message.side_effect = Forbidden("customer blocked bot")
        update = self.update("/responder 1 Resposta", chat_id=-1001)
        await self.service.respond(update, self.context)
        self.assertIn("Não foi possível", update.effective_message.reply_text.await_args.args[0])


class ApplicationRoutingTests(unittest.IsolatedAsyncioTestCase):
    async def test_registered_handlers_process_real_updates_end_to_end_without_network(self):
        sent = []

        async def fake_request(request, url, method, request_data=None, **kwargs):
            api_method = url.rsplit("/", 1)[-1].lower()
            if api_method == "getme":
                result = {"id": 123456, "is_bot": True, "first_name": "Atendimento", "username": "triagem_test_bot"}
            elif api_method == "sendmessage":
                parameters = request_data.parameters
                sent.append(parameters)
                chat_id = int(parameters["chat_id"])
                result = {
                    "message_id": len(sent), "date": 1780000000,
                    "chat": {"id": chat_id, "type": "private" if chat_id > 0 else "supergroup"},
                    "text": parameters["text"],
                }
            else:
                raise AssertionError(f"Unexpected API method in offline test: {api_method}")
            return 200, json.dumps({"ok": True, "result": result}).encode()

        with TemporaryDirectory() as directory:
            settings = Settings(
                token="123456:OFFLINE_TEST_ONLY", database_path=Path(directory) / "tickets.sqlite3",
                team_chats={"suporte": -1001, "financeiro": -1002},
            )
            # Only transport responses are stubbed. Handlers, Telegram objects,
            # command parsing, user_data and SQLite all run normally.
            with patch("telegram.request.HTTPXRequest.do_request", new=fake_request):
                application = build_application(settings)
                async with application:
                    async def process(text, chat_id=42):
                        payload = {
                            "update_id": len(sent) + 1,
                            "message": {
                                "message_id": len(sent) + 1, "date": 1780000000,
                                "chat": {"id": chat_id, "type": "private" if chat_id > 0 else "supergroup"},
                                "from": {"id": 42, "is_bot": False, "first_name": "Maria", "username": "maria"},
                                "text": text,
                            },
                        }
                        if text.startswith("/"):
                            payload["message"]["entities"] = [
                                {"type": "bot_command", "offset": 0, "length": len(text.split()[0])}
                            ]
                        await application.process_update(Update.de_json(payload, application.bot))

                    await process("/start")
                    self.assertIn("Digite o número", sent[-1]["text"])
                    # Group chatter must not start a private data-collection flow.
                    count = len(sent)
                    await process("1", chat_id=-1001)
                    self.assertEqual(len(sent), count)
                    await process("2")
                    await process("Maria")
                    await process("Minha Empresa")
                    await process("Preciso da segunda via do boleto.")
                    team_notification = [item for item in sent if int(item["chat_id"]) < 0]
                    self.assertEqual(len(team_notification), 1)
                    self.assertEqual(int(team_notification[0]["chat_id"]), -1002)
                    self.assertIn("segunda via do boleto", team_notification[0]["text"])
                    ticket = TicketStore(settings.database_path).get_ticket(1)
                    self.assertEqual(ticket.delivery_status, "delivered")
                    self.assertEqual(ticket.department, "financeiro")
                    await process("/responder 1 Vamos ajudar você.", chat_id=-1002)
                    client_replies = [item for item in sent if "Vamos ajudar você." in item["text"]]
                    self.assertEqual(len(client_replies), 1)
                    self.assertEqual(int(client_replies[0]["chat_id"]), 42)


if __name__ == "__main__":
    unittest.main()
