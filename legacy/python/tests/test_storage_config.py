import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

from chatbot.config import Settings
from chatbot.departments import DEPARTMENTS, menu_text, select_department
from chatbot.storage import TicketStore


class SettingsTests(unittest.TestCase):
    def test_defaults_and_secret_redaction(self):
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "sensitive-test-token"}, clear=True):
            settings = Settings.from_env()
        self.assertEqual(settings.database_path, Path("data/atendimento.sqlite3"))
        self.assertEqual(settings.company_name, "Atendimento")
        self.assertEqual(settings.team_chats, {})
        self.assertNotIn("sensitive-test-token", repr(settings))

    def test_department_override_and_fallback(self):
        with patch.dict(os.environ, {
            "TELEGRAM_BOT_TOKEN": "test-token",
            "TEAM_CHAT_ID": "-10012345",
            "SUPORTE_CHAT_ID": "-10099999",
            "DATABASE_PATH": "/tmp/test.sqlite3",
            "COMPANY_NAME": "Minha empresa",
        }, clear=True):
            settings = Settings.from_env()
        self.assertEqual(settings.team_chats["suporte"], -10099999)
        self.assertEqual(settings.team_chats["financeiro"], -10012345)
        self.assertEqual(set(settings.team_chats), {"suporte", "financeiro"})
        self.assertEqual(settings.company_name, "Minha empresa")
        self.assertEqual(settings.database_path, Path("/tmp/test.sqlite3"))

    def test_inactive_department_variables_do_not_create_destinations(self):
        with patch.dict(os.environ, {
            "TELEGRAM_BOT_TOKEN": "test-token",
            "IMPLANTACAO_CHAT_ID": "inactive-value",
            "COMERCIAL_CHAT_ID": "inactive-value",
            "QUALIDADE_CHAT_ID": "inactive-value",
            "PRO2PAY_CHAT_ID": "inactive-value",
        }, clear=True):
            settings = Settings.from_env()
        self.assertEqual(settings.team_chats, {})

    def test_missing_token(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "TELEGRAM_BOT_TOKEN"):
                Settings.from_env()

    def test_invalid_destination_does_not_leak_value(self):
        with patch.dict(os.environ, {
            "TELEGRAM_BOT_TOKEN": "secret",
            "FINANCEIRO_CHAT_ID": "private-invalid-value",
        }, clear=True):
            with self.assertRaises(ValueError) as raised:
                Settings.from_env()
        self.assertIn("FINANCEIRO_CHAT_ID", str(raised.exception))
        self.assertNotIn("private-invalid-value", str(raised.exception))
        self.assertNotIn("secret", str(raised.exception))

    def test_zero_destination_is_invalid(self):
        with patch.dict(os.environ, {
            "TELEGRAM_BOT_TOKEN": "test", "TEAM_CHAT_ID": "0"
        }, clear=True):
            with self.assertRaisesRegex(ValueError, "TEAM_CHAT_ID"):
                Settings.from_env()

    def test_positive_private_chat_destinations_are_invalid(self):
        for variable in ("TEAM_CHAT_ID", "SUPORTE_CHAT_ID", "FINANCEIRO_CHAT_ID"):
            with self.subTest(variable=variable):
                with patch.dict(os.environ, {
                    "TELEGRAM_BOT_TOKEN": "test", variable: "123456789"
                }, clear=True):
                    with self.assertRaisesRegex(ValueError, variable):
                        Settings.from_env()


class DepartmentTests(unittest.TestCase):
    def test_support_and_finance_choices_by_number_and_keyboard_label(self):
        self.assertEqual(
            [(department.number, department.key, department.label) for department in DEPARTMENTS],
            [(1, "suporte", "Suporte"), (2, "financeiro", "Financeiro")],
        )
        for department in DEPARTMENTS:
            with self.subTest(department=department.key):
                self.assertEqual(select_department(f" {department.number} "), department)
                label = f"{department.number} - {department.label} {department.emoji}"
                self.assertEqual(select_department(label.upper()), department)
                self.assertIn(label, menu_text())

    def test_invalid_choice_is_not_a_department(self):
        for value in ("", "3", "4", "5", "6", "7", "0", "12", "quero ajuda", "1-anything",
                      "Implantação", "Comercial", "Qualidade e Sucesso do Cliente",
                      "Meios de Pagamento da Pro2Pay", "2 - Implantação 🧑‍💻"):
            with self.subTest(value=value):
                self.assertIsNone(select_department(value))


class TicketStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.path = Path(self.temporary_directory.name) / "data" / "tickets.sqlite3"
        self.store = TicketStore(self.path)

    def create_ticket(self, **overrides):
        values = dict(
            chat_id=123,
            username="cliente",
            department="suporte",
            customer_name="Maria",
            company="Empresa",
            description="Não consigo entrar no sistema; preciso de ajuda.",
        )
        values.update(overrides)
        return self.store.create_ticket(**values)

    def test_ticket_survives_new_store_and_preserves_content(self):
        ticket = self.create_ticket(username=None, description="O'Brien; DROP TABLE tickets;")
        reopened = TicketStore(self.path)
        self.assertEqual(reopened.get_ticket(ticket.id), ticket)
        self.assertEqual(ticket.delivery_status, "pending")
        self.assertIsNone(ticket.username)
        self.assertTrue(ticket.created_at.endswith("+00:00"))
        self.assertEqual(reopened.pending_tickets(), [ticket])

    def test_delivery_removes_only_selected_pending_ticket(self):
        first = self.create_ticket()
        second = self.create_ticket(chat_id=456, department="financeiro")
        self.store.mark_delivered(first.id)
        self.assertEqual(self.store.get_ticket(first.id).delivery_status, "delivered")
        self.assertEqual(self.store.pending_tickets(), [second])
        self.assertGreater(second.id, first.id)
        self.assertIsNone(self.store.get_ticket(9999))

    def test_new_database_is_private(self):
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
