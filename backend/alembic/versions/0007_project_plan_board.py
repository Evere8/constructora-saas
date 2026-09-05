"""Connect project plans, levels and level checklists into an operational board.

Revision ID: 0007_project_plan_board
Revises: 0006_elongations_v2
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_project_plan_board"
down_revision: str | None = "0006_elongations_v2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    # One selected version feeds the project's visual Resumen without changing
    # the immutable plan document/version history.
    op.add_column("projects", sa.Column("overview_plan_version_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_projects_overview_plan_version",
        "projects",
        "plan_versions",
        ["overview_plan_version_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column("project_levels", sa.Column("building_name", sa.String(120), nullable=True))
    op.add_column(
        "project_levels",
        sa.Column("work_status", sa.String(20), nullable=False, server_default="pending"),
    )
    op.add_column("project_levels", sa.Column("concreted_at", sa.Date(), nullable=True))
    op.add_column("project_levels", sa.Column("plan_version_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_project_levels_plan_version",
        "project_levels",
        "plan_versions",
        ["plan_version_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("project_levels", sa.Column("plan_page_number", sa.Integer(), nullable=True))
    op.add_column("project_levels", sa.Column("plan_geometry_json", sa.JSON(), nullable=True))

    op.add_column("checklist_items", sa.Column("level_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_checklist_items_level",
        "checklist_items",
        "project_levels",
        ["level_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("checklist_items", sa.Column("performed_on", sa.Date(), nullable=True))
    op.create_index(
        "ix_checklists_company_project_level_status",
        "checklist_items",
        ["company_id", "project_id", "level_id", "status"],
    )

    # Legacy controls already tied to a task inherit that task's level.  Nothing
    # is moved or duplicated; only the direct filter column is filled.
    op.execute(
        "UPDATE checklist_items AS item "
        "JOIN tasks AS task ON task.id = item.task_id "
        "SET item.level_id = task.level_id "
        "WHERE item.level_id IS NULL AND task.level_id IS NOT NULL"
    )
    # Existing levels deserve the same independent field checklist as levels
    # created after this migration.  Missing stages are inserted only once.
    op.execute(
        "INSERT INTO checklist_items "
        "(id, company_id, project_id, level_id, title, process_stage, status, created_at) "
        "SELECT UUID(), project.company_id, level.project_id, level.id, template.title, "
        "template.stage, 'pending', NOW() "
        "FROM project_levels AS level "
        "JOIN projects AS project ON project.id = level.project_id "
        "CROSS JOIN ("
        "SELECT 'Cortados' AS title, 'cortados' AS stage "
        "UNION ALL SELECT 'En obra', 'en_obra' "
        "UNION ALL SELECT 'Anclajes colocados', 'anclajes_colocados' "
        "UNION ALL SELECT 'Colocación de cabos', 'colocacion_de_cabos' "
        "UNION ALL SELECT 'Ataduras', 'ataduras' "
        "UNION ALL SELECT 'Revisado', 'revisado'"
        ") AS template "
        "LEFT JOIN checklist_items AS existing ON "
        "existing.company_id = project.company_id "
        "AND existing.project_id = level.project_id "
        "AND existing.level_id = level.id "
        "AND existing.process_stage = template.stage "
        "WHERE existing.id IS NULL"
    )

    op.add_column("annotations", sa.Column("level_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_annotations_level",
        "annotations",
        "project_levels",
        ["level_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_annotations_level", "annotations", ["level_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_annotations_level", table_name="annotations")
    op.drop_constraint("fk_annotations_level", "annotations", type_="foreignkey")
    op.drop_column("annotations", "level_id")

    op.drop_index("ix_checklists_company_project_level_status", table_name="checklist_items")
    op.drop_column("checklist_items", "performed_on")
    op.drop_constraint("fk_checklist_items_level", "checklist_items", type_="foreignkey")
    op.drop_column("checklist_items", "level_id")

    op.drop_constraint("fk_project_levels_plan_version", "project_levels", type_="foreignkey")
    op.drop_column("project_levels", "plan_geometry_json")
    op.drop_column("project_levels", "plan_page_number")
    op.drop_column("project_levels", "plan_version_id")
    op.drop_column("project_levels", "concreted_at")
    op.drop_column("project_levels", "work_status")
    op.drop_column("project_levels", "building_name")

    op.drop_constraint("fk_projects_overview_plan_version", "projects", type_="foreignkey")
    op.drop_column("projects", "overview_plan_version_id")
