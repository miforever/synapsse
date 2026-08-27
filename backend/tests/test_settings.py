import aiosqlite

from app.canvas.models import MediaSettings, SettingsPatch
from app.canvas.settings import get_settings, update_settings


async def test_defaults_before_anything_is_stored(conn: aiosqlite.Connection) -> None:
    settings = await get_settings(conn)

    assert settings.media.images is True
    assert settings.media.remote_content is False


async def test_a_toggle_round_trips(conn: aiosqlite.Connection) -> None:
    patch = SettingsPatch(media=MediaSettings(remote_content=True))

    merged = await update_settings(conn, patch)

    # The reply is what the panel renders from, so it carries the whole model
    # and not just what was sent.
    assert merged.media.remote_content is True
    assert merged.media.images is True
    assert (await get_settings(conn)).media.remote_content is True
