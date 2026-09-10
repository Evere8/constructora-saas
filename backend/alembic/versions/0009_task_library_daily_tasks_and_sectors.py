"""Add reusable task library, personal daily tasks, and sector-aware levels.

Revision ID: 0009_task_library_daily_tasks_and_sectors
Revises: 0008_inventory_relocations
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.migration_support import ResumableDDL

revision: str = "0009_task_library_daily_tasks_and_sectors"
down_revision: str | None = "0008_inventory_relocations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    ddl = ResumableDDL(op)
    # This revision has 41 characters; Alembic's default VARCHAR(32) could
    # not record it, leaving committed MySQL tables behind on every retry.
    ddl.ensure_version_capacity()
    ddl.create_table(
        "task_templates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "company_id",
            sa.String(36),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("task_type", sa.String(20), nullable=False, server_default="work"),
        sa.Column("priority", sa.String(15), nullable=False, server_default="normal"),
        sa.Column("default_location_text", sa.String(300), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_by_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    ddl.create_index(
        "ix_task_templates_company_active",
        "task_templates",
        ["company_id", "is_active"],
    )
    ddl.create_table(
        "task_template_requirements",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "template_id",
            sa.String(36),
            sa.ForeignKey("task_templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "inventory_item_id",
            sa.String(36),
            sa.ForeignKey("inventory_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("description", sa.String(220), nullable=False),
        sa.Column("required_quantity", sa.Numeric(14, 3), nullable=False),
        sa.Column("unit", sa.String(30), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    ddl.create_index(
        "ix_task_template_requirements_template",
        "task_template_requirements",
        ["template_id"],
    )
    ddl.create_table(
        "task_template_checklist_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "template_id",
            sa.String(36),
            sa.ForeignKey("task_templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    ddl.create_index(
        "ix_task_template_checklist_template",
        "task_template_checklist_items",
        ["template_id", "sort_order"],
    )
    ddl.add_column("tasks", sa.Column("template_id", sa.String(36), nullable=True))
    ddl.create_foreign_key(
        "fk_tasks_template",
        "tasks",
        "task_templates",
        ["template_id"],
        ["id"],
        ondelete="SET NULL",
    )

    ddl.create_table(
        "daily_task_templates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "company_id",
            sa.String(36),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "assigned_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("auto_renew_daily", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_by_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    ddl.create_index(
        "ix_daily_task_templates_company_assignee_active",
        "daily_task_templates",
        ["company_id", "assigned_user_id", "is_active"],
    )
    ddl.create_table(
        "daily_task_template_checklist_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "template_id",
            sa.String(36),
            sa.ForeignKey("daily_task_templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    ddl.create_index(
        "ix_daily_task_template_checklist_template",
        "daily_task_template_checklist_items",
        ["template_id", "sort_order"],
    )
    ddl.create_table(
        "daily_tasks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "company_id",
            sa.String(36),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "template_id",
            sa.String(36),
            sa.ForeignKey("daily_task_templates.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "assigned_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("task_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(25), nullable=False, server_default="pending"),
        sa.Column(
            "created_by_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
        sa.UniqueConstraint("template_id", "task_date", name="uq_daily_task_template_date"),
    )
    ddl.create_index(
        "ix_daily_tasks_company_assignee_date_status",
        "daily_tasks",
        ["company_id", "assigned_user_id", "task_date", "status"],
    )
    ddl.create_table(
        "daily_task_checklist_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "daily_task_id",
            sa.String(36),
            sa.ForeignKey("daily_tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(25), nullable=False, server_default="pending"),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )
    ddl.create_index(
        "ix_daily_task_checklist_task",
        "daily_task_checklist_items",
        ["daily_task_id", "sort_order"],
    )

    # A level number is only unique inside one sector.  Existing levels are
    # placed under a default sector so no legacy data becomes ambiguous.
    op.execute(
        "UPDATE project_levels SET building_name = 'Obra general' "
        "WHERE building_name IS NULL OR TRIM(building_name) = ''"
    )
    # A replacement index must exist before removing the index MySQL uses
    # for project_levels.project_id's foreign key (otherwise error 1553).
    ddl.create_unique_constraint(
        "uq_project_level_sector_name",
        "project_levels",
        ["project_id", "building_name", "name"],
    )
    ddl.drop_unique_if_present("uq_project_level_name", "project_levels")


def downgrade() -> None:
    op.drop_constraint("uq_project_level_sector_name", "project_levels", type_="unique")
    op.create_unique_constraint("uq_project_level_name", "project_levels", ["project_id", "name"])

    op.drop_index("ix_daily_task_checklist_task", table_name="daily_task_checklist_items")
    op.drop_table("daily_task_checklist_items")
    op.drop_index("ix_daily_tasks_company_assignee_date_status", table_name="daily_tasks")
    op.drop_table("daily_tasks")
    op.drop_index(
        "ix_daily_task_template_checklist_template",
        table_name="daily_task_template_checklist_items",
    )
    op.drop_table("daily_task_template_checklist_items")
    op.drop_index(
        "ix_daily_task_templates_company_assignee_active",
        table_name="daily_task_templates",
    )
    op.drop_table("daily_task_templates")

    op.drop_constraint("fk_tasks_template", "tasks", type_="foreignkey")
    op.drop_column("tasks", "template_id")
    op.drop_index(
        "ix_task_template_checklist_template",
        table_name="task_template_checklist_items",
    )
    op.drop_table("task_template_checklist_items")
    op.drop_index("ix_task_template_requirements_template", table_name="task_template_requirements")
    op.drop_table("task_template_requirements")
    op.drop_index("ix_task_templates_company_active", table_name="task_templates")
    op.drop_table("task_templates")
