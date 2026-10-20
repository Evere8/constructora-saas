"""Persist pen strokes and notes on interactive rubro PDFs.

Revision ID: 0012_perforation_annotations
Revises: 0011_project_rubros_and_perforations
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.migration_support import ResumableDDL

revision: str = "0012_perforation_annotations"
down_revision: str | None = "0011_project_rubros_and_perforations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    ddl = ResumableDDL(op)
    ddl.create_table(
        "perforation_annotations",
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
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("points_json", sa.JSON(), nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("color_hex", sa.String(7), nullable=False),
        sa.Column("stroke_width", sa.Integer(), nullable=False),
        sa.Column("opacity", sa.Numeric(4, 3), nullable=False),
        sa.Column(
            "created_by_user_id", sa.String(36), sa.ForeignKey("app_users.id"), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    ddl.create_index(
        "ix_perforation_annotations_document_page",
        "perforation_annotations",
        ["document_id", "page_number", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_perforation_annotations_document_page", table_name="perforation_annotations")
    op.drop_table("perforation_annotations")
