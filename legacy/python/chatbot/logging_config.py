"""Configure logs without exposing the bot token in URLs or tracebacks."""

import logging
import re
from urllib.parse import quote, quote_plus


class TokenRedactingFormatter(logging.Formatter):
    """Redact after formatting, so exception messages are covered as well."""

    def __init__(self, token: str):
        super().__init__("%(levelname)s %(name)s: %(message)s")
        variants = {
            token,
            quote(token),
            quote(token, safe=""),
            quote_plus(token, safe=""),
        }
        patterns = []
        for variant in sorted(variants, key=len, reverse=True):
            if not variant:
                continue
            # Percent escapes are case-insensitive; the secret itself is not.
            escaped = re.escape(variant)
            escaped = re.sub(
                r"%([0-9A-Fa-f]{2})",
                lambda match: "%" + "".join(
                    f"[{character.lower()}{character.upper()}]"
                    if character.isalpha() else character
                    for character in match.group(1)
                ),
                escaped,
            )
            patterns.append(escaped)
        self._secrets = re.compile("|".join(patterns)) if patterns else None

    def format(self, record: logging.LogRecord) -> str:
        formatted = super().format(record)
        return self._secrets.sub("[TOKEN OCULTO]", formatted) if self._secrets else formatted


def configure_logging(token: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(TokenRedactingFormatter(token))
    logging.basicConfig(level=logging.WARNING, handlers=[handler], force=True)
    # HTTP request logs include the bot token in the Telegram API URL.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
