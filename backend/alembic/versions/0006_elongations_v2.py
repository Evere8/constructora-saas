"""Add additive V2 workflow storage for elongation documentation.

Revision ID: 0006_elongations_v2
Revises: 0005_alerts_and_reports
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_elongations_v2"
down_revision: str | None = "0005_alerts_and_reports"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "elongation_jobs",
        sa.Column(
            "level_id",
            sa.String(36),
            sa.ForeignKey("project_levels.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "elongation_jobs",
        sa.Column(
            "responsible_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "elongation_jobs",
        sa.Column("workflow_status", sa.String(32), nullable=False, server_default="draft"),
    )
    op.add_column("elongation_jobs", sa.Column("template_mapping_json", sa.JSON(), nullable=True))
    op.add_column("elongation_jobs", sa.Column("processing_summary_json", sa.JSON(), nullable=True))
    op.add_column(
        "elongation_jobs",
        sa.Column(
            "theory_approved_by_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("elongation_jobs", sa.Column("theory_approved_at", sa.DateTime(), nullable=True))
    op.add_column(
        "elongation_jobs",
        sa.Column(
            "approved_by_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("elongation_jobs", sa.Column("approved_at", sa.DateTime(), nullable=True))
    op.add_column(
        "elongation_jobs",
        sa.Column("version_number", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column("elongation_jobs", sa.Column("idempotency_key", sa.String(130), nullable=True))
    op.create_unique_constraint(
        "uq_elongation_job_source_template_sha",
        "elongation_jobs",
        ["company_id", "project_id", "idempotency_key"],
    )

    op.add_column(
        "elongation_items",
        sa.Column("label_number", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("elongation_items", sa.Column("raw_label", sa.String(100), nullable=True))
    op.add_column("elongation_items", sa.Column("raw_text", sa.Text(), nullable=True))
    op.add_column(
        "elongation_items",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "elongation_items",
        sa.Column("theory_review_status", sa.String(20), nullable=False, server_default="pending"),
    )
    op.add_column("elongation_items", sa.Column("field_confidence_json", sa.JSON(), nullable=True))
    op.add_column(
        "elongation_items",
        sa.Column(
            "reviewed_by_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("elongation_items", sa.Column("reviewed_at", sa.DateTime(), nullable=True))
    op.add_column("elongation_items", sa.Column("source_page", sa.Integer(), nullable=True))
    op.add_column("elongation_items", sa.Column("source_file_id", sa.String(36), nullable=True))
    # V1 allowed only a final classification.  V2 needs an explicit unresolved state rather than
    # silently treating every OCR candidate as distributed.
    op.drop_constraint("ck_elongation_classification", "elongation_items", type_="check")
    op.create_check_constraint(
        "ck_elongation_classification_v2",
        "elongation_items",
        "classification in ('band','distributed','unknown')",
    )

    op.create_table(
        "elongation_job_files",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "job_id",
            sa.String(36),
            sa.ForeignKey("elongation_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("storage_key", sa.String(500), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(120), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("processing_status", sa.String(30), nullable=False, server_default="uploaded"),
        sa.Column("processing_summary_json", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.String(500), nullable=True),
        sa.Column(
            "uploaded_by_user_id", sa.String(36), sa.ForeignKey("app_users.id"), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "job_id", "kind", "version_number", name="uq_elongation_file_job_kind_ver"
        ),
        sa.Index("ix_elongation_files_job_kind", "job_id", "kind"),
    )
    op.create_foreign_key(
        "fk_elongation_items_source_file",
        "elongation_items",
        "elongation_job_files",
        ["source_file_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "elongation_classification_zones",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "job_id",
            sa.String(36),
            sa.ForeignKey("elongation_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("classification", sa.String(20), nullable=False),
        sa.Column("name", sa.String(100), nullable=True),
        sa.Column("geometry_json", sa.JSON(), nullable=False),
        sa.Column(
            "created_by_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "classification in ('band','distributed')",
            name="ck_elongation_zone_classification",
        ),
        sa.Index("ix_elongation_zones_job", "job_id", "created_at"),
    )
    op.create_table(
        "elongation_measurements",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "job_id",
            sa.String(36),
            sa.ForeignKey("elongation_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "item_id",
            sa.String(36),
            sa.ForeignKey("elongation_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("measured_elongation", sa.Numeric(12, 3), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Numeric(5, 4), nullable=True),
        sa.Column("match_method", sa.String(30), nullable=True),
        sa.Column("review_status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("override_reason", sa.Text(), nullable=True),
        sa.Column(
            "source_file_id",
            sa.String(36),
            sa.ForeignKey("elongation_job_files.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source_page", sa.Integer(), nullable=True),
        sa.Column("source_location_json", sa.JSON(), nullable=True),
        sa.Column(
            "reviewed_by_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("item_id", "ordinal", name="uq_elongation_measurement_item_ordinal"),
        sa.Index("ix_elongation_measurements_job_item", "job_id", "item_id"),
    )
    op.create_table(
        "elongation_exports",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "job_id",
            sa.String(36),
            sa.ForeignKey("elongation_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "file_id",
            sa.String(36),
            sa.ForeignKey("elongation_job_files.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("snapshot_json", sa.JSON(), nullable=False),
        sa.Column(
            "created_by_user_id", sa.String(36), sa.ForeignKey("app_users.id"), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "job_id", "kind", "version_number", name="uq_elongation_export_job_kind_ver"
        ),
        sa.Index("ix_elongation_exports_job_kind", "job_id", "kind"),
    )

    # Preserve legacy data.  A legacy single measured value becomes ordinal 1, never a guessed S
    # list.  Existing source fields remain untouched for compatibility with /documents.
    op.execute(
        "UPDATE elongation_items "
        "SET label_number = COALESCE("
        "CAST(NULLIF(REGEXP_REPLACE(label, '[^0-9]', ''), '') AS UNSIGNED), 0), "
        "sort_order = COALESCE("
        "CAST(NULLIF(REGEXP_REPLACE(label, '[^0-9]', ''), '') AS UNSIGNED), 0), "
        "raw_label = COALESCE(raw_label, label), theory_review_status = review_status"
    )
    op.execute(
        "UPDATE elongation_jobs SET workflow_status = CASE "
        "WHEN status = 'review_required' THEN 'theory_review' "
        "WHEN status = 'processing' THEN 'processing_theory' "
        "WHEN status = 'failed' THEN 'failed_theory' "
        "ELSE 'draft' END"
    )
    op.execute(
        "INSERT INTO elongation_measurements "
        "(id, job_id, item_id, ordinal, measured_elongation, review_status, created_at) "
        "SELECT UUID(), item.job_id, item.id, 1, item.measured_elongation, "
        "item.review_status, NOW() "
        "FROM elongation_items AS item WHERE item.measured_elongation IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_table("elongation_exports")
    op.drop_table("elongation_measurements")
    op.drop_table("elongation_classification_zones")
    op.drop_constraint("fk_elongation_items_source_file", "elongation_items", type_="foreignkey")
    op.drop_table("elongation_job_files")
    op.drop_constraint("ck_elongation_classification_v2", "elongation_items", type_="check")
    op.create_check_constraint(
        "ck_elongation_classification",
        "elongation_items",
        "classification in ('band','distributed')",
    )
    for name in (
        "source_file_id",
        "source_page",
        "reviewed_at",
        "reviewed_by_user_id",
        "field_confidence_json",
        "theory_review_status",
        "sort_order",
        "raw_text",
        "raw_label",
        "label_number",
    ):
        op.drop_column("elongation_items", name)
    op.drop_constraint(
        "uq_elongation_job_source_template_sha",
        "elongation_jobs",
        type_="unique",
    )
    for name in (
        "idempotency_key",
        "version_number",
        "approved_at",
        "approved_by_user_id",
        "theory_approved_at",
        "theory_approved_by_user_id",
        "processing_summary_json",
        "template_mapping_json",
        "workflow_status",
        "responsible_user_id",
        "level_id",
    ):
        op.drop_column("elongation_jobs", name)
