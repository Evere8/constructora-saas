"""Add configurable rubros, perforation canvases and task scope.

Revision ID: 0011_project_rubros_and_perforations
Revises: 0010_project_sectors_and_level_bands
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.migration_support import ResumableDDL

revision: str = "0011_project_rubros_and_perforations"
down_revision: str | None = "0010_project_sectors_and_level_bands"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    ddl = ResumableDDL(op)
    ddl.ensure_version_capacity()
    ddl.create_table(
        "project_rubros",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "company_id",
            sa.String(36),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
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
        sa.UniqueConstraint("project_id", "slug", name="uq_project_rubro_slug"),
    )
    ddl.create_index(
        "ix_project_rubros_project_order", "project_rubros", ["project_id", "sort_order"]
    )
    ddl.create_table(
        "project_rubro_features",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "rubro_id",
            sa.String(36),
            sa.ForeignKey("project_rubros.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("feature_key", sa.String(60), nullable=False),
        sa.Column("settings_json", sa.JSON(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("rubro_id", "feature_key", name="uq_project_rubro_feature"),
    )
    ddl.create_index(
        "ix_project_rubro_features_rubro_order",
        "project_rubro_features",
        ["rubro_id", "sort_order"],
    )
    ddl.create_table(
        "project_rubro_observations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "company_id",
            sa.String(36),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "rubro_id",
            sa.String(36),
            sa.ForeignKey("project_rubros.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
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
        "ix_project_rubro_observations_rubro_created",
        "project_rubro_observations",
        ["rubro_id", "created_at"],
    )

    ddl.create_table(
        "perforation_documents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "company_id",
            sa.String(36),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "rubro_id",
            sa.String(36),
            sa.ForeignKey("project_rubros.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("storage_key", sa.String(500), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(120), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column(
            "created_by_user_id", sa.String(36), sa.ForeignKey("app_users.id"), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    ddl.create_index(
        "ix_perforation_documents_rubro_created",
        "perforation_documents",
        ["rubro_id", "created_at"],
    )
    ddl.create_table(
        "perforation_colors",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "rubro_id",
            sa.String(36),
            sa.ForeignKey("project_rubros.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("color_hex", sa.String(12), nullable=False),
        sa.Column("checklist_json", sa.JSON(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    ddl.create_index(
        "ix_perforation_colors_rubro_order", "perforation_colors", ["rubro_id", "sort_order"]
    )
    ddl.create_table(
        "perforation_points",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "company_id",
            sa.String(36),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "rubro_id",
            sa.String(36),
            sa.ForeignKey("project_rubros.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "document_id",
            sa.String(36),
            sa.ForeignKey("perforation_documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "color_id",
            sa.String(36),
            sa.ForeignKey("perforation_colors.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("page_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("x", sa.Numeric(8, 6), nullable=False),
        sa.Column("y", sa.Numeric(8, 6), nullable=False),
        sa.Column("diameter", sa.Numeric(8, 6), nullable=False, server_default="0.026"),
        sa.Column("label", sa.String(180), nullable=True),
        sa.Column("color_hex", sa.String(12), nullable=False),
        sa.Column("checklist_json", sa.JSON(), nullable=False),
        sa.Column("note_text", sa.Text(), nullable=True),
        sa.Column("note_storage_key", sa.String(500), nullable=True),
        sa.Column("note_original_filename", sa.String(255), nullable=True),
        sa.Column("note_mime_type", sa.String(120), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "created_by_user_id", sa.String(36), sa.ForeignKey("app_users.id"), nullable=False
        ),
    )
    ddl.create_index(
        "ix_perforation_points_document_page", "perforation_points", ["document_id", "page_number"]
    )
    ddl.create_index(
        "ix_perforation_points_rubro_status", "perforation_points", ["rubro_id", "status"]
    )

    ddl.add_column("tasks", sa.Column("rubro_id", sa.String(36), nullable=True))
    ddl.create_foreign_key(
        "fk_tasks_rubro", "tasks", "project_rubros", ["rubro_id"], ["id"], ondelete="SET NULL"
    )
    ddl.create_index(
        "ix_tasks_company_project_rubro", "tasks", ["company_id", "project_id", "rubro_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_tasks_company_project_rubro", table_name="tasks")
    op.drop_constraint("fk_tasks_rubro", "tasks", type_="foreignkey")
    op.drop_column("tasks", "rubro_id")
    op.drop_index("ix_perforation_points_rubro_status", table_name="perforation_points")
    op.drop_index("ix_perforation_points_document_page", table_name="perforation_points")
    op.drop_table("perforation_points")
    op.drop_index("ix_perforation_colors_rubro_order", table_name="perforation_colors")
    op.drop_table("perforation_colors")
    op.drop_index("ix_perforation_documents_rubro_created", table_name="perforation_documents")
    op.drop_table("perforation_documents")
    op.drop_index(
        "ix_project_rubro_observations_rubro_created", table_name="project_rubro_observations"
    )
    op.drop_table("project_rubro_observations")
    op.drop_index("ix_project_rubro_features_rubro_order", table_name="project_rubro_features")
    op.drop_table("project_rubro_features")
    op.drop_index("ix_project_rubros_project_order", table_name="project_rubros")
    op.drop_table("project_rubros")
