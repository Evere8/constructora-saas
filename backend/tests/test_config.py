from app.core.config import Settings


def test_database_url_encodes_password() -> None:
    settings = Settings(mysql_password="p@ss/word")
    rendered = settings.database_url.render_as_string(hide_password=False)
    assert "p%40ss%2Fword" in rendered
    assert rendered.startswith("mysql+asyncmy://")


def test_cors_origins_are_split() -> None:
    settings = Settings(mysql_password="test", cors_origins="https://a.test, https://b.test")
    assert settings.cors_origin_list == ["https://a.test", "https://b.test"]
    assert settings.invite_redirect_url == "https://a.test/restablecer"


def test_evidence_storage_defaults_are_safe() -> None:
    settings = Settings(mysql_password="test")
    assert str(settings.upload_root) == "/data/uploads"
    assert settings.evidence_max_bytes == 10 * 1024 * 1024
