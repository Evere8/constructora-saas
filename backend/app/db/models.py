from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Plan(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "plans"

    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    limits_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class Company(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "companies"

    name: Mapped[str] = mapped_column(String(180), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    plan_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("plans.id"), nullable=True)

    memberships: Mapped[list[CompanyMembership]] = relationship(back_populates="company")
    projects: Mapped[list[Project]] = relationship(back_populates="company")


class AppUser(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "app_users"

    supabase_user_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(String(254), nullable=False, index=True)
    full_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    is_platform_admin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )

    memberships: Mapped[list[CompanyMembership]] = relationship(back_populates="user")


class CompanyMembership(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "company_memberships"
    __table_args__ = (
        UniqueConstraint("company_id", "user_id", name="uq_membership_company_user"),
        Index("ix_membership_user_status", "user_id", "status"),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    company: Mapped[Company] = relationship(back_populates="memberships")
    user: Mapped[AppUser] = relationship(back_populates="memberships")


class Project(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("company_id", "code", name="uq_project_company_code"),
        Index("ix_projects_company_status", "company_id", "status"),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    company: Mapped[Company] = relationship(back_populates="projects")


class ProjectLevel(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "project_levels"
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_project_level_name"),)

    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Task(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        Index("ix_tasks_company_project_status", "company_id", "project_id", "status"),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    level_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("project_levels.id", ondelete="SET NULL"), nullable=True
    )
    task_type: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(25), nullable=False, default="pending")
    priority: Mapped[str] = mapped_column(String(15), nullable=False, default="normal")
    assigned_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )
    planned_start_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    location_text: Mapped[str | None] = mapped_column(String(300), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )


class TaskMaterialRequirement(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "task_material_requirements"
    __table_args__ = (Index("ix_task_requirements_task", "task_id"),)

    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    inventory_item_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("inventory_items.id", ondelete="SET NULL"), nullable=True
    )
    description: Mapped[str] = mapped_column(String(220), nullable=False)
    required_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    unit: Mapped[str] = mapped_column(String(30), nullable=False)
    availability_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="unchecked"
    )


class ChecklistItem(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "checklist_items"
    __table_args__ = (
        Index(
            "ix_checklists_company_project_status",
            "company_id",
            "project_id",
            "status",
        ),
        Index(
            "ix_checklists_company_task_status",
            "company_id",
            "task_id",
            "status",
        ),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True
    )
    plan_version_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("plan_versions.id", ondelete="SET NULL"), nullable=True
    )
    annotation_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("annotations.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    process_stage: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(25), nullable=False, default="pending")
    assigned_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class ChecklistEvidence(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "checklist_evidence"
    __table_args__ = (
        Index("ix_evidence_company_item_created", "company_id", "checklist_item_id", "created_at"),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    checklist_item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("checklist_items.id", ondelete="CASCADE"), nullable=False
    )
    evidence_type: Mapped[str] = mapped_column(String(20), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    uploaded_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class InventoryItem(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "inventory_items"
    __table_args__ = (
        UniqueConstraint("company_id", "code", name="uq_inventory_company_code"),
        Index("ix_inventory_company_project", "company_id", "current_project_id"),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    item_type: Mapped[str] = mapped_column(String(20), nullable=False)
    unit: Mapped[str] = mapped_column(String(30), nullable=False, default="unit")
    serial_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(25), nullable=False, default="available")
    current_project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class InventoryMovement(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "inventory_movements"
    __table_args__ = (
        Index("ix_movements_company_date", "company_id", "moved_at"),
        Index("ix_movements_item_date", "item_id", "moved_at"),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False
    )
    from_project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    to_project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    condition_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    moved_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )
    moved_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class PlanDocument(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "plan_documents"
    __table_args__ = (Index("ix_plans_company_project", "company_id", "project_id"),)

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    level_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("project_levels.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class PlanVersion(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "plan_versions"
    __table_args__ = (
        UniqueConstraint("document_id", "version_number", name="uq_plan_version_number"),
    )

    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("plan_documents.id", ondelete="CASCADE"), nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class Annotation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "annotations"
    __table_args__ = (Index("ix_annotations_plan_page", "plan_version_id", "page_number"),)

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    plan_version_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("plan_versions.id", ondelete="CASCADE"), nullable=False
    )
    page_number: Mapped[int] = mapped_column(Integer, nullable=False)
    annotation_type: Mapped[str] = mapped_column(String(30), nullable=False)
    geometry_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    style_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )


class ElongationJob(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "elongation_jobs"
    __table_args__ = (
        Index("ix_elongation_company_project_created", "company_id", "project_id", "created_at"),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    plan_version_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("plan_versions.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(220), nullable=False, default="Documento técnico")
    source_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="document")
    source_storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(25), nullable=False, default="uploaded")
    tolerance_percent: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("7.00")
    )
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class ElongationItem(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "elongation_items"
    __table_args__ = (UniqueConstraint("job_id", "label", name="uq_elongation_job_label"),)

    job_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("elongation_jobs.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(50), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    length_m: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    strand_count: Mapped[int] = mapped_column(Integer, nullable=False)
    calculated_elongation: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    measured_elongation: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    review_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    source_location_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class Notification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint("company_id", "dedupe_key", name="uq_notification_company_dedupe"),
        Index("ix_notifications_company_resolved_due", "company_id", "resolved_at", "due_at"),
        Index("ix_notifications_assignee", "assigned_user_id", "resolved_at"),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    task_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True
    )
    checklist_item_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("checklist_items.id", ondelete="CASCADE"), nullable=True
    )
    requirement_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("task_material_requirements.id", ondelete="CASCADE"),
        nullable=True,
    )
    assigned_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )
    alert_type: Mapped[str] = mapped_column(String(40), nullable=False)
    severity: Mapped[str] = mapped_column(String(15), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(180), nullable=False)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class NotificationReceipt(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "notification_receipts"
    __table_args__ = (
        UniqueConstraint("notification_id", "user_id", name="uq_notification_receipt_user"),
        Index("ix_notification_receipts_user_status", "user_id", "status"),
    )

    notification_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(15), nullable=False, default="read")
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ActivityLog(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "activity_logs"

    company_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=True
    )
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
