from io import StringIO
from types import SimpleNamespace

import pytest
import sqlalchemy as sa

from alembic.config import Config
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from app.db.migration_support import ResumableDDL


def test_revision_capacity_covers_published_ids_without_renaming_history():
    context = MigrationContext.configure(dialect_name="mysql")
    revisions = ScriptDirectory.from_config(Config("alembic.ini")).walk_revisions()
    longest = max(len(item.revision) for item in revisions)
    assert longest == 41
    assert context._version.c.version_num.type.length == 32  # reproduce the original mismatch
    assert longest <= 128

    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="mysql",
        opts={"as_sql": True, "output_buffer": output},
    )
    ddl = ResumableDDL(Operations(context))
    ddl.inspector = lambda: SimpleNamespace(
        get_columns=lambda _: [
            {"name": "version_num", "type": sa.String(32)},
        ]
    )
    ddl.ensure_version_capacity()
    assert "MODIFY version_num VARCHAR(128) NOT NULL" in output.getvalue()


def test_retry_keeps_existing_table_rows_and_indexes():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        ddl = ResumableDDL(Operations(MigrationContext.configure(connection)))
        for attempt in range(2):
            ddl.create_table("example", sa.Column("id", sa.Integer, primary_key=True))
            ddl.create_index("ix_example", "example", ["id"])
            ddl.add_column("example", sa.Column("name", sa.String(120)))
            if attempt == 0:
                connection.execute(
                    sa.text("INSERT INTO example (id, name) VALUES (1, 'preserved')")
                )
        assert connection.execute(sa.text("SELECT id, name FROM example")).all() == [
            (1, "preserved")
        ]


def test_retry_does_not_silently_accept_an_unexpected_table():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE example (id INTEGER)"))
        ddl = ResumableDDL(Operations(MigrationContext.configure(connection)))
        with pytest.raises(RuntimeError, match="estructura inesperada"):
            ddl.create_table("example", sa.Column("id", sa.Integer), sa.Column("missing", sa.Text))
