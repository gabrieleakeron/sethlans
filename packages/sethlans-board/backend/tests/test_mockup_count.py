"""Test unitari per l'helper di conteggio mockup (D3) e i campi derivati."""
from models import count_mockups

MOCKUP_BLOCK = "```mockup\n<html></html>\n```"


def test_count_mockups_zero_on_empty_or_none():
    assert count_mockups(None) == 0
    assert count_mockups("") == 0
    assert count_mockups("# Solo testo, nessun blocco mockup") == 0


def test_count_mockups_single_block():
    md = f"# Titolo\n\n{MOCKUP_BLOCK}\n"
    assert count_mockups(md) == 1


def test_count_mockups_multiple_blocks():
    md = f"# Titolo\n\n{MOCKUP_BLOCK}\n\ntesto in mezzo\n\n{MOCKUP_BLOCK}\n\n{MOCKUP_BLOCK}\n"
    assert count_mockups(md) == 3


def test_count_mockups_ignores_literal_fence_text_inside_block():
    """Regressione: il contenuto HTML di un blocco puo' contenere la stringa
    letterale ```mockup``` (es. copy di un empty-state) senza che ciascuna
    occorrenza apra un blocco fantasma — solo le fence reali contano."""
    block_with_nested_literal = (
        "```mockup\n"
        "<html><body>"
        "<p>Empty state: nessun blocco ```mockup``` nella discendenza, "
        "mostra invece ``` come placeholder.</p>"
        "</body></html>\n"
        "```"
    )
    md = f"# Titolo\n\n{block_with_nested_literal}\n"
    assert count_mockups(md) == 1


def test_count_mockups_four_real_blocks_with_nested_literal_text():
    """Riproduce lo scenario s48280475: 4 blocchi reali, ciascuno con testo che
    cita ```mockup``` internamente — non deve raddoppiare il conteggio (era 8)."""
    block = (
        "```mockup\n"
        "<p>vedi sezione ```mockup``` per dettagli</p>\n"
        "```"
    )
    md = "\n\n".join("# Sezione " + str(i) + "\n\n" + block for i in range(4))
    assert count_mockups(md) == 4


def test_count_mockups_unclosed_fence_closed_at_eof():
    md = "# Titolo\n\n```mockup\n<html>contenuto senza fence di chiusura</html>\n"
    assert count_mockups(md) == 1
