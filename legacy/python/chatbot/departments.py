"""The customer-facing menu and stable department identifiers."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Department:
    number: int
    key: str
    label: str
    emoji: str


DEPARTMENTS = (
    Department(1, "suporte", "Suporte", "⚙️"),
    Department(2, "financeiro", "Financeiro", "💰"),
)


def select_department(text: str) -> Department | None:
    """Accept a menu number, a department name, or its reply-keyboard label."""
    selection = text.strip().casefold()
    for department in DEPARTMENTS:
        labels = (
            str(department.number),
            department.label.casefold(),
            f"{department.number} - {department.label} {department.emoji}".casefold(),
        )
        if selection in labels:
            return department
    return None


def menu_text() -> str:
    options = "\n".join(
        f"{department.number} - {department.label} {department.emoji}"
        for department in DEPARTMENTS
    )
    return f"Digite o número da opção desejada ou toque em um botão:\n\n{options}"
