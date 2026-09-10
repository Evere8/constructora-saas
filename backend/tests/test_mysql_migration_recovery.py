"""Real MySQL 8.4 regression tests, in disposable databases only.

Opt in with MIGRATION_TEST_MYSQL_HOST=127.0.0.1 and
MIGRATION_TEST_MYSQL_PASSWORD (the isolated CI MySQL service, never production).
"""

import asyncio
import json
import os
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from alembic import command
from alembic.config import Config
from alembic.operations import Operations
from app.core.config import get_settings

REV9 = "0009_task_library_daily_tasks_and_sectors"
HEAD = "0010_project_sectors_and_level_bands"
pytestmark = pytest.mark.skipif(
    not os.getenv("MIGRATION_TEST_MYSQL_HOST"),
    reason="Requires isolated MySQL test service",
)


class TestDatabase:
    __test__ = False

    def __init__(self, url):
        self.url = url
        self.company_id, self.project_id, self.user_id = (str(uuid4()) for _ in range(3))

    def run(self, function):
        async def execute():
            engine = create_async_engine(self.url, poolclass=NullPool)
            try:
                async with engine.begin() as connection:
                    return await connection.run_sync(function)
            finally:
                await engine.dispose()

        return asyncio.run(execute())

    def upgrade(self, revision="head"):
        command.upgrade(Config("alembic.ini"), revision)

    def seed(self, connection):
        connection.execute(
            sa.text("INSERT INTO companies (id,name,slug) VALUES (:id,'Test','test')"),
            {"id": self.company_id},
        )
        connection.execute(
            sa.text(
                "INSERT INTO app_users (id,supabase_user_id,email) "
                "VALUES (:id,:id,'test@example.invalid')"
            ),
            {"id": self.user_id},
        )
        connection.execute(
            sa.text("INSERT INTO projects (id,company_id,name) VALUES (:id,:company_id,'Test')"),
            {"id": self.project_id, "company_id": self.company_id},
        )
        for number, sector in enumerate(["Torre A", "Torre B", None, "Obra general"]):
            level_id = str(uuid4())
            connection.execute(
                sa.text(
                    "INSERT INTO project_levels (id,project_id,name,sort_order,building_name, "
                    "plan_geometry_json) VALUES (:id,:project_id,:name,:number,:sector,:geometry)"
                ),
                {
                    "id": level_id,
                    "project_id": self.project_id,
                    "name": f"Nivel {number}",
                    "number": number,
                    "sector": sector,
                    "geometry": json.dumps({"x": 0.1, "y": 0.1, "width": 0.4, "height": 0.02}),
                },
            )
            connection.execute(
                sa.text(
                    "INSERT INTO checklist_items "
                    "(id,company_id,project_id,level_id,title,status,performed_on) "
                    "VALUES (:id,:company_id,:project_id,:level_id,"
                    "'Cortados','completed','2026-09-01')"
                ),
                {
                    "id": str(uuid4()),
                    "company_id": self.company_id,
                    "project_id": self.project_id,
                    "level_id": level_id,
                },
            )

    def snapshot(self):
        def read(connection):
            return (
                connection.execute(
                    sa.text("SELECT id,name,plan_geometry_json FROM project_levels ORDER BY id")
                ).all(),
                connection.execute(
                    sa.text(
                        "SELECT id,level_id,title,status,performed_on "
                        "FROM checklist_items ORDER BY id"
                    )
                ).all(),
            )

        return self.run(read)

    def assert_migrated(self, before):
        assert self.snapshot() == before

        def check(connection):
            assert connection.scalar(sa.text("SELECT version_num FROM alembic_version")) == HEAD
            assert connection.scalar(sa.text("SELECT COUNT(*) FROM project_sectors")) == 3
            assert (
                connection.scalar(
                    sa.text("SELECT COUNT(*) FROM project_levels WHERE sector_id IS NULL")
                )
                == 0
            )
            indexes = {
                item["name"] for item in sa.inspect(connection).get_indexes("project_levels")
            }
            assert "uq_project_level_name" not in indexes
            assert "uq_project_level_sector_name" not in indexes
            assert "uq_project_level_sector_id_name" in indexes

        self.run(check)


@pytest.fixture
def database(monkeypatch):
    host = os.environ["MIGRATION_TEST_MYSQL_HOST"]
    if host not in {"127.0.0.1", "localhost"}:
        pytest.fail("Only the local disposable MySQL service is allowed")
    password = os.environ["MIGRATION_TEST_MYSQL_PASSWORD"]
    database_name = "obrixapy_migration_test_" + uuid4().hex
    url = sa.URL.create(
        "mysql+asyncmy",
        username="root",
        password=password,
        host=host,
        port=3306,
        query={"charset": "utf8mb4"},
    )
    admin = TestDatabase(url)
    admin.run(lambda conn: conn.exec_driver_sql(f"CREATE DATABASE `{database_name}`"))
    try:
        for key, value in {
            "MYSQL_HOST": host,
            "MYSQL_PORT": "3306",
            "MYSQL_USER": "root",
            "MYSQL_PASSWORD": password,
            "MYSQL_DATABASE": database_name,
        }.items():
            monkeypatch.setenv(key, value)
        get_settings.cache_clear()
        db = TestDatabase(url.set(database=database_name))
        db.upgrade("0008_inventory_relocations")
        db.run(db.seed)
        yield db
    finally:
        # Exact randomly generated test DB only; never a configured application DB.
        assert database_name.startswith("obrixapy_migration_test_")
        admin.run(lambda conn: conn.exec_driver_sql(f"DROP DATABASE `{database_name}`"))
        get_settings.cache_clear()


def test_reproduce_original_mysql_errors_then_upgrade(database):
    before = database.snapshot()
    with pytest.raises(sa.exc.DBAPIError, match="1406"):
        database.run(
            lambda conn: conn.execute(
                sa.text("UPDATE alembic_version SET version_num = :revision"), {"revision": REV9}
            )
        )
    with pytest.raises(sa.exc.DBAPIError, match="1553"):
        database.run(
            lambda conn: conn.exec_driver_sql(
                "ALTER TABLE project_levels DROP INDEX uq_project_level_name"
            )
        )
    database.upgrade()
    database.assert_migrated(before)
    database.upgrade()  # normal repeated deployment is a no-op
    database.assert_migrated(before)


@pytest.mark.parametrize(
    ("method", "target"),
    [
        ("create_index", "ix_daily_task_checklist_task"),
        ("create_foreign_key", "fk_project_levels_sector"),
        ("create_index", "ix_project_levels_project_sector_order"),
    ],
)
def test_recover_after_committed_partial_ddl(database, monkeypatch, method, target):
    before = database.snapshot()
    original = getattr(Operations, method)

    def interrupt(operation, name, *args, **kwargs):
        result = original(operation, name, *args, **kwargs)
        if name == target:
            raise RuntimeError("simulated interruption after committed DDL")
        return result

    with monkeypatch.context() as patch:
        patch.setattr(Operations, method, interrupt)
        with pytest.raises(RuntimeError, match="simulated interruption"):
            database.upgrade()
    database.run(
        lambda conn: conn.execute(
            sa.text(
                "INSERT INTO task_templates (id,company_id,title) "
                "VALUES (:id,:company,'Keep this task')"
            ),
            {"id": str(uuid4()), "company": database.company_id},
        )
    )
    database.upgrade()
    database.assert_migrated(before)
    assert (
        database.run(lambda conn: conn.scalar(sa.text("SELECT COUNT(*) FROM task_templates"))) == 1
    )


def test_levels_sectors_and_checklist_routes_after_migration(database):
    database.upgrade()

    async def requests():
        from app.api.dependencies import get_company_access
        from app.db.session import get_db
        from app.main import app

        engine = create_async_engine(database.url, poolclass=NullPool)
        sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async def session_override():
            async with sessions() as session:
                yield session

        # Only authentication is stubbed; handlers, serialization and MySQL are real.
        app.dependency_overrides[get_db] = session_override
        app.dependency_overrides[get_company_access] = lambda: SimpleNamespace(
            company_id=database.company_id,
            role="owner",
            user=SimpleNamespace(id=database.user_id),
        )
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
            ) as client:
                base = f"/api/v1/companies/{database.company_id}/projects/{database.project_id}"
                for suffix in ["/levels", "/sectors", "/checklist", "/checklist/progress"]:
                    response = await client.get(base + suffix)
                    assert response.status_code == 200, (suffix, response.text)
                sectors = (await client.get(base + "/sectors")).json()
                for sector in sectors[:2]:
                    response = await client.post(
                        base + "/levels",
                        json={
                            "name": "Nivel 10",
                            "sector_id": sector["id"],
                        },
                    )
                    assert response.status_code == 201, response.text
                duplicate = await client.post(
                    base + "/levels",
                    json={
                        "name": "Nivel 10",
                        "sector_id": sectors[0]["id"],
                    },
                )
                assert duplicate.status_code == 409
                assert len((await client.get(base + "/levels")).json()) == 6
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_company_access, None)
            await engine.dispose()

    asyncio.run(requests())
