from app.core.config import Settings


def test_database_url_encodes_password() -> None:
    settings = Settings(mysql_password="p@ss/word")
    rendered = settings.database_url.render_as_string(hide_password=False)
    assert "p%40ss%2Fword" in rendered
    assert rendered.startswith("mysql+asyncmy://")


def test_cors_origins_are_split() -> None:
    settings = Settings(mysql_password="test", cors_origins="https://a.test, https://b.test")
    assert settings.cors_origin_list == ["https://a.test", "https://b.test"]
