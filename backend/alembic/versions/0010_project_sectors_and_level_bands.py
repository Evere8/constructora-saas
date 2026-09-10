"""Persist project sectors and keep level mappings presentation-aware.

Revision ID: 0010_project_sectors_and_level_bands
Revises: 0009_task_library_daily_tasks_and_sectors
"""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa

from alembic import op
from app.db.migration_support import ResumableDDL

revision: str = "0010_project_sectors_and_level_bands"
down_revision: str | None = "0009_task_library_daily_tasks_and_sectors"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    ddl = ResumableDDL(op)
    ddl.ensure_version_capacity()
    ddl.create_table(
        "project_sectors",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
        sa.UniqueConstraint("project_id", "name", name="uq_project_sector_name"),
    )
    ddl.create_index(
        "ix_project_sectors_project_order",
        "project_sectors",
        ["project_id", "sort_order"],
    )

    # Turn every pre-existing textual sector into a real independent column.
    # Python-generated UUIDs keep this portable across MySQL and local test DBs.
    connection = op.get_bind()
    ddl.add_column("project_levels", sa.Column("sector_id", sa.String(36), nullable=True))
    # Normalize legacy blank labels consistently in both creation and linking.
    # Use the database's comparison/collation, not Python string equality.
    rows = connection.execute(
        sa.text(
            "SELECT project_id, COALESCE(NULLIF(TRIM(building_name), ''), 'Obra general') "
            "AS sector_name, MIN(sort_order) AS sort_order FROM project_levels "
            "WHERE sector_id IS NULL GROUP BY project_id, sector_name"
        )
    ).mappings()
    sector_rows = list(rows)
    for row in sector_rows:
        sector_id = connection.execute(
            sa.text(
                "SELECT id FROM project_sectors WHERE project_id = :project_id AND name = :name"
            ),
            {"project_id": row["project_id"], "name": row["sector_name"]},
        ).scalar_one_or_none()
        if sector_id is not None:
            continue
        connection.execute(
            sa.text(
                "INSERT INTO project_sectors (id, project_id, name, sort_order) "
                "VALUES (:id, :project_id, :name, :sort_order)"
            ),
            {
                "id": str(uuid4()),
                "project_id": row["project_id"],
                "name": row["sector_name"],
                "sort_order": row["sort_order"] or 0,
            },
        )

    sectors = list(
        connection.execute(sa.text("SELECT id, project_id, name FROM project_sectors")).mappings()
    )
    for row in sectors:
        connection.execute(
            sa.text(
                "UPDATE project_levels SET sector_id = :sector_id, building_name = :name "
                "WHERE sector_id IS NULL AND project_id = :project_id "
                "AND COALESCE(NULLIF(TRIM(building_name), ''), 'Obra general') = :name"
            ),
            {"sector_id": row["id"], "project_id": row["project_id"], "name": row["name"]},
        )

    missing = connection.scalar(
        sa.text("SELECT COUNT(*) FROM project_levels WHERE sector_id IS NULL")
    )
    if missing:
        raise RuntimeError(f"Quedan {missing} niveles sin sector; no se ha eliminado ningún nivel")
    sector_column = next(
        column
        for column in sa.inspect(connection).get_columns("project_levels")
        if column["name"] == "sector_id"
    )
    if sector_column["nullable"]:
        op.alter_column(
            "project_levels",
            "sector_id",
            existing_type=sa.String(length=36),
            nullable=False,
        )
    ddl.create_foreign_key(
        "fk_project_levels_sector",
        "project_levels",
        "project_sectors",
        ["sector_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    ddl.create_unique_constraint(
        "uq_project_level_sector_id_name",
        "project_levels",
        ["project_id", "sector_id", "name"],
    )
    ddl.create_index(
        "ix_project_levels_project_sector_order",
        "project_levels",
        ["project_id", "sector_id", "sort_order"],
    )
    ddl.drop_unique_if_present("uq_project_level_sector_name", "project_levels")
    ddl.drop_unique_if_present("uq_project_level_name", "project_levels")


def downgrade() -> None:
    op.drop_index("ix_project_levels_project_sector_order", table_name="project_levels")
    op.drop_constraint("uq_project_level_sector_id_name", "project_levels", type_="unique")
    op.create_unique_constraint(
        "uq_project_level_sector_name",
        "project_levels",
        ["project_id", "building_name", "name"],
    )
    op.drop_constraint("fk_project_levels_sector", "project_levels", type_="foreignkey")
    op.drop_column("project_levels", "sector_id")
    op.drop_index("ix_project_sectors_project_order", table_name="project_sectors")
    op.drop_table("project_sectors")
