import io
import logging
import sys
import unittest
from urllib.parse import quote, quote_plus
from unittest.mock import patch

from telegram.error import InvalidToken

from chatbot.logging_config import configure_logging


class LoggingConfigTests(unittest.TestCase):
    def setUp(self):
        root = logging.getLogger()
        self.old_handlers = root.handlers[:]
        self.old_level = root.level
        self.old_http_levels = {
            name: logging.getLogger(name).level for name in ("httpx", "httpcore")
        }
        # Preserve any test-runner handlers without letting basicConfig close them.
        for handler in self.old_handlers:
            root.removeHandler(handler)
        self.output = io.StringIO()
        self.stream_patch = patch.object(sys, "stderr", self.output)
        self.stream_patch.start()
        self.addCleanup(self.restore_logging)

    def restore_logging(self):
        root = logging.getLogger()
        for handler in root.handlers[:]:
            root.removeHandler(handler)
            handler.close()
        for handler in self.old_handlers:
            root.addHandler(handler)
        root.setLevel(self.old_level)
        for name, level in self.old_http_levels.items():
            logging.getLogger(name).setLevel(level)
        self.stream_patch.stop()

    def test_redacts_token_in_message_url_and_rejected_token_traceback(self):
        token = "123456:sentinel-secret_ABC-xyz"
        configure_logging(token)
        logger = logging.getLogger("telegram.ext._utils.networkloop")
        try:
            try:
                raise InvalidToken("Unauthorized")
            except InvalidToken as original:
                raise InvalidToken(f"The token `{token}` was rejected by the server.") from original
        except InvalidToken:
            logger.exception("Bootstrap failed at https://api.telegram.org/bot%s/getMe", token)
        text = self.output.getvalue()
        self.assertNotIn(token, text)
        self.assertIn("[TOKEN OCULTO]", text)
        self.assertIn("Traceback", text)
        self.assertIn("InvalidToken", text)
        self.assertIn("Unauthorized", text)

    def test_redacts_url_encoded_and_lowercase_percent_escapes(self):
        token = "123:sentinel/token+with spaces?"
        configure_logging(token)
        variants = {
            token,
            quote(token),
            quote(token, safe=""),
            quote_plus(token, safe=""),
            quote(token, safe="").replace("%3A", "%3a").replace("%2F", "%2f"),
        }
        for variant in variants:
            logging.warning("Request URL https://api.telegram.org/bot%s/getMe", variant)
        text = self.output.getvalue()
        for variant in variants:
            self.assertNotIn(variant, text)
        self.assertEqual(text.count("[TOKEN OCULTO]"), len(variants))

    def test_http_info_is_suppressed_but_errors_are_visible_and_redacted(self):
        token = "123:secret"
        configure_logging(token)
        for name in ("httpx", "httpcore"):
            logger = logging.getLogger(name)
            logger.info("Request details")
            logger.warning("Request failed: %s", token)
        text = self.output.getvalue()
        self.assertNotIn("Request details", text)
        self.assertNotIn(token, text)
        self.assertEqual(text.count("Request failed: [TOKEN OCULTO]"), 2)


if __name__ == "__main__":
    unittest.main()
