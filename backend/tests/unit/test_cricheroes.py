from datetime import date

import pytest

from app.core.exceptions import ValidationFailed
from app.modules.cricheroes.schemas import CricHeroesSnapshotIn
from app.modules.cricheroes.service import normalise_snapshot, parse_match_date
from app.modules.cricheroes.urls import parse_team_ref, safe_cricheroes_url


@pytest.mark.parametrize(
    "raw",
    [
        "https://cricheroes.com/team-profile/2580003/CP-Sm@shers/members",
        "https://cricheroes.in/team-profile/2580003/CP-Sm@shers",
        "cricheroes.com/team-profile/2580003/CP-Sm@shers/matches/",
        "https://www.cricheroes.in/team-profile/2580003/CP-Sm%40shers",
        "2580003/CP-Sm@shers",
    ],
)
def test_parse_team_ref_accepts_known_forms(raw: str) -> None:
    ref = parse_team_ref(raw)
    assert ref.external_team_id == 2580003
    assert ref.slug == "CP-Sm@shers"
    assert ref.url == "https://cricheroes.com/team-profile/2580003/CP-Sm@shers"


@pytest.mark.parametrize(
    "raw",
    [
        "https://evil.example/team-profile/1/x",
        "https://cricheroes.com.evil.example/team-profile/1/x",
        "javascript:alert(1)",
        "https://cricheroes.com/player-profile/1/x",
        "ftp://cricheroes.com/team-profile/1/x",
    ],
)
def test_parse_team_ref_rejects_others(raw: str) -> None:
    with pytest.raises(ValidationFailed):
        parse_team_ref(raw)


def test_safe_url_only_allows_cricheroes_hosts() -> None:
    assert safe_cricheroes_url("/player-profile/9/x") == "https://cricheroes.com/player-profile/9/x"
    assert safe_cricheroes_url("http://cricheroes.in/scorecard/1") == "https://cricheroes.in/scorecard/1"
    assert safe_cricheroes_url("javascript:alert(1)") is None
    assert safe_cricheroes_url("//evil.example/x") is None
    assert safe_cricheroes_url("https://media.cricheroes.in/logo.jpg") is None  # media host only when media=True
    assert (
        safe_cricheroes_url("https://media.cricheroes.in/logo.jpg", media=True)
        == "https://media.cricheroes.in/logo.jpg"
    )


def test_parse_match_date_formats() -> None:
    assert parse_match_date("07-Apr-23") == date(2023, 4, 7)  # cricheroes package's encoder format
    assert parse_match_date("2026-10-31") == date(2026, 10, 31)
    assert parse_match_date("not a date") is None
    assert parse_match_date(None) is None


def test_normalise_drops_unsafe_links_and_rejects_empty() -> None:
    snap = normalise_snapshot(
        CricHeroesSnapshotIn.model_validate(
            {
                "players": [{"name": "A", "profile_url": "javascript:x", "profile_pic_url": "ignored"}],
                "stats": [{"label": "Won", "value": 12}],
            }
        )
    )
    assert snap["players"][0]["profile_url"] is None
    assert snap["stats"] == [{"label": "Won", "value": "12"}]
    with pytest.raises(ValidationFailed):
        normalise_snapshot(CricHeroesSnapshotIn.model_validate({"team_name": "Only a name"}))
