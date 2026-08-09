import json
import logging
from pathlib import Path
from typing import Any

from pydantic.fields import FieldInfo
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)

logger = logging.getLogger(__name__)

# Where the editable settings live. Beside the working directory rather than
# inside the package, so configuring a daemon never means editing its source.
CONFIG_FILE = Path("config.json")


def _from_file(path: Path = CONFIG_FILE) -> dict[str, Any]:
    """Read config.json, if there is one.

    Deliberately forgiving: a daemon that will not start because its optional
    settings file has a trailing comma is worse than one that runs on its
    defaults and says so in the log.
    """
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        logger.warning("Ignoring unreadable %s", path, exc_info=True)
        return {}

    if not isinstance(data, dict):
        logger.warning("Ignoring %s: expected an object at the top level", path)
        return {}
    # Unknown keys are dropped rather than raising: this file is edited by
    # hand, and a stale key from an older version must not stop the daemon.
    return {key: value for key, value in data.items() if key in Settings.model_fields}


class JsonConfigSource(PydanticBaseSettingsSource):
    """Reads settings from config.json.

    A source rather than constructor arguments, because where it sits in the
    order is the whole point: init arguments outrank the environment in
    pydantic-settings, which would have a checked-in file quietly overriding
    the variable someone set for this one run.
    """

    def __init__(self, settings_cls: type[BaseSettings]) -> None:
        super().__init__(settings_cls)
        # Read once per load, not once per field: pydantic asks every source
        # for every field it defines, and re-parsing the file a dozen times to
        # build one settings object is a dozen syscalls for one answer.
        self._values = _from_file()

    def get_field_value(
        self, field: FieldInfo, field_name: str
    ) -> tuple[Any, str, bool]:
        return self._values.get(field_name), field_name, False

    def __call__(self) -> dict[str, Any]:
        return self._values


class Settings(BaseSettings):
    """Daemon configuration.

    Three layers, each overriding the one before: the defaults here, then
    `config.json` in the working directory, then `SYNAPSSE_*` environment
    variables. The file is for the settings you keep — where the store lives,
    how large an attachment may be — and the environment for the ones that
    belong to a particular run, which is why it wins.
    """

    model_config = SettingsConfigDict(env_prefix="SYNAPSSE_")

    db_path: str = "synapsse.db"
    host: str = "127.0.0.1"
    port: int = 8000

    # Shared secret for every request that is not /health. Unset by default,
    # because on 127.0.0.1 the loopback interface is already the access
    # control and a mandatory token would be ceremony for a single user on
    # their own machine. Set it — and you must, before binding anywhere else —
    # and the daemon refuses anything that cannot present it.
    auth_token: str | None = None

    # Where attached files are kept. Beside the database on purpose: the two
    # are one store, and backing up either alone leaves memories pointing at
    # files that are not there.
    files_path: str = "synapsse_files"

    # Per-file ceiling. Generous for documents and screenshots, low enough
    # that a stray upload cannot fill the disk in one request.
    max_file_bytes: int = 50 * 1024 * 1024

    # Local embedding model, fetched once and then run offline on CPU.
    # e5 is retrieval-tuned and multilingual, so memories written in any
    # language stay searchable.
    embedding_model: str = "intfloat/multilingual-e5-large"
    embedding_dim: int = 1024

    # The canvas is served from its own origin in both dev and Docker.
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # Order is priority, first wins: an explicit argument, then the
        # environment, then the file, then the defaults on the fields.
        return (
            init_settings,
            env_settings,
            dotenv_settings,
            JsonConfigSource(settings_cls),
            file_secret_settings,
        )


settings = Settings()
