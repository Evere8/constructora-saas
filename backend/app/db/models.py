from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
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
    true,
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
    can_register_inventory_day: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
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
    # The version selected as the shared operational board.  Plan documents remain
    # versioned independently; this merely selects which version the Resumen opens.
    overview_plan_version_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("plan_versions.id", ondelete="SET NULL"), nullable=True
    )

    company: Mapped[Company] = relationship(back_populates="projects")


class ProjectSector(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A persistent work sector inside one project.

    A sector is intentionally independent from its levels so a user can create
    its column before loading the first slab.  ``building_name`` stays on the
    level for backwards-compatible PDF label detection, while ``sector_id`` is
    the authoritative relation used for uniqueness and ordering.
    """

    __tablename__ = "project_sectors"
    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_project_sector_name"),
        Index("ix_project_sectors_project_order", "project_id", "sort_order"),
    )

    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ProjectRubro(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A configurable project work stream (Postensado, Perforaciones, etc.).

    The name and its functions belong to the project, rather than the company,
    because the same company can use a different set of work streams per work.
    ``slug`` is stable enough for the built-in streams while custom streams can
    safely use a generated slug.
    """

    __tablename__ = "project_rubros"
    __table_args__ = (
        UniqueConstraint("project_id", "slug", name="uq_project_rubro_slug"),
        Index("ix_project_rubros_project_order", "project_id", "sort_order"),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )


class ProjectRubroFeature(UUIDPrimaryKeyMixin, Base):
    """An independently enabled function inside a project work stream."""

    __tablename__ = "project_rubro_features"
    __table_args__ = (
        UniqueConstraint("rubro_id", "feature_key", name="uq_project_rubro_feature"),
        Index("ix_project_rubro_features_rubro_order", "rubro_id", "sort_order"),
    )

    rubro_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project_rubros.id", ondelete="CASCADE"), nullable=False
    )
    feature_key: Mapped[str] = mapped_column(String(60), nullable=False)
    settings_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ProjectRubroObservation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Short field observations scoped to a rubro without creating a task."""

    __tablename__ = "project_rubro_observations"
    __table_args__ = (
        Index("ix_project_rubro_observations_rubro_created", "rubro_id", "created_at"),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    rubro_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project_rubros.id", ondelete="CASCADE"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )


class ProjectLevel(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "project_levels"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "sector_id",
            "name",
            name="uq_project_level_sector_id_name",
        ),
        Index("ix_project_levels_project_sector_order", "project_id", "sector_id", "sort_order"),
    )

    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    sector_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project_sectors.id", ondelete="RESTRICT"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    building_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # ``concreted`` is intentionally separate from generic checklist completion: a
    # supervisor may close every preparation step but the slab is not concreted yet.
    work_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    concreted_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    plan_version_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("plan_versions.id", ondelete="SET NULL"), nullable=True
    )
    plan_page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Normalized x/y/width/height so zones remain valid regardless of browser size.
    plan_geometry_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class Task(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        Index("ix_tasks_company_project_status", "company_id", "project_id", "status"),
        CheckConstraint(
            "status in ('pending','received','in_progress','missing_tool','review',"
            "'custom','completed','cancelled')",
            name="ck_tasks_status",
        ),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    template_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("task_templates.id", ondelete="SET NULL"), nullable=True
    )
    level_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("project_levels.id", ondelete="SET NULL"), nullable=True
    )
    rubro_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("project_rubros.id", ondelete="SET NULL"), nullable=True
    )
    task_type: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(25), nullable=False, default="pending")
    custom_status_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
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


class TaskTemplate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Reusable company task definition with its default resources and checklist."""

    __tablename__ = "task_templates"
    __table_args__ = (Index("ix_task_templates_company_active", "company_id", "is_active"),)

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    task_type: Mapped[str] = mapped_column(String(20), nullable=False, default="work")
    priority: Mapped[str] = mapped_column(String(15), nullable=False, default="normal")
    default_location_text: Mapped[str | None] = mapped_column(String(300), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )


class TaskTemplateRequirement(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "task_template_requirements"
    __table_args__ = (Index("ix_task_template_requirements_template", "template_id"),)

    template_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("task_templates.id", ondelete="CASCADE"), nullable=False
    )
    inventory_item_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("inventory_items.id", ondelete="SET NULL"), nullable=True
    )
    description: Mapped[str] = mapped_column(String(220), nullable=False)
    required_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    unit: Mapped[str] = mapped_column(String(30), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class TaskTemplateChecklistItem(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "task_template_checklist_items"
    __table_args__ = (Index("ix_task_template_checklist_template", "template_id", "sort_order"),)

    template_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("task_templates.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class DailyTaskTemplate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Personal recurring task definition, materialised each day when needed."""

    __tablename__ = "daily_task_templates"
    __table_args__ = (
        Index(
            "ix_daily_task_templates_company_assignee_active",
            "company_id",
            "assigned_user_id",
            "is_active",
        ),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    assigned_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    auto_renew_daily: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )


class DailyTaskTemplateChecklistItem(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "daily_task_template_checklist_items"
    __table_args__ = (
        Index("ix_daily_task_template_checklist_template", "template_id", "sort_order"),
    )

    template_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("daily_task_templates.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class DailyTask(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "daily_tasks"
    __table_args__ = (
        UniqueConstraint("template_id", "task_date", name="uq_daily_task_template_date"),
        Index(
            "ix_daily_tasks_company_assignee_date_status",
            "company_id",
            "assigned_user_id",
            "task_date",
            "status",
        ),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    template_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("daily_task_templates.id", ondelete="SET NULL"), nullable=True
    )
    assigned_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False
    )
    task_date: Mapped[date] = mapped_column(Date, nullable=False)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(25), nullable=False, default="pending")
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )


class DailyTaskChecklistItem(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "daily_task_checklist_items"
    __table_args__ = (Index("ix_daily_task_checklist_task", "daily_task_id", "sort_order"),)

    daily_task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("daily_tasks.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(25), nullable=False, default="pending")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


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
    level_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("project_levels.id", ondelete="SET NULL"), nullable=True
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
    # The actual field date captured on a level checklist.  ``completed_at`` is
    # retained for existing APIs and audit compatibility.
    performed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
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


class InventoryDaySnapshot(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "inventory_day_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "company_id", "snapshot_date", "revision", name="uq_inventory_day_revision"
        ),
        Index("ix_inventory_day_company_date", "company_id", "snapshot_date", "revision"),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    items_json: Mapped[list] = mapped_column(JSON, nullable=False)
    registered_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )
    registered_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class InventoryRestockRequest(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "inventory_restock_requests"
    __table_args__ = (Index("ix_inventory_restock_company_status", "company_id", "status"),)

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    requested_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class ActivityDefinition(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "activity_definitions"
    __table_args__ = (UniqueConstraint("company_id", "title", name="uq_activity_company_title"),)

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    requirements_json: Mapped[list] = mapped_column(JSON, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class DailyActivityPlan(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "daily_activity_plans"
    __table_args__ = (
        UniqueConstraint("company_id", "plan_date", name="uq_activity_plan_company_date"),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    plan_date: Mapped[date] = mapped_column(Date, nullable=False)
    entries_json: Mapped[list] = mapped_column(JSON, nullable=False)
    registered_by_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=True
    )
    registered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class InventoryRelocationRequest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A requested move that must be confirmed before changing an item's location."""

    __tablename__ = "inventory_relocation_requests"
    __table_args__ = (
        Index("ix_inventory_relocations_company_status", "company_id", "status"),
        Index("ix_inventory_relocations_task_status", "task_id", "status"),
        Index("ix_inventory_relocations_item_status", "inventory_item_id", "status"),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    inventory_item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False
    )
    from_project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    to_project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    assigned_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )
    requested_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(25), nullable=False, default="pending")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


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


class ProjectFolder(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "project_folders"
    __table_args__ = (Index("ix_project_folders_parent", "company_id", "project_id", "parent_id"),)

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("project_folders.id", ondelete="RESTRICT"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class ProjectFile(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "project_files"
    __table_args__ = (Index("ix_project_files_folder", "company_id", "project_id", "folder_id"),)

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    folder_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("project_folders.id", ondelete="RESTRICT"), nullable=True
    )
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    stored_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_encoding: Mapped[str] = mapped_column(String(16), nullable=False, default="identity")
    compression_checked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    drive_key: Mapped[str] = mapped_column(String(250), nullable=False, unique=True)
    uploaded_by_user_id: Mapped[str] = mapped_column(
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
    level_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("project_levels.id", ondelete="SET NULL"), nullable=True
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


class PerforationDocument(UUIDPrimaryKeyMixin, Base):
    """An uploaded, private PDF/image canvas used by the Perforaciones rubro."""

    __tablename__ = "perforation_documents"
    __table_args__ = (Index("ix_perforation_documents_rubro_created", "rubro_id", "created_at"),)

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    rubro_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project_rubros.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class PerforationColor(UUIDPrimaryKeyMixin, Base):
    """A reusable color/status and the checklist it starts for each new point."""

    __tablename__ = "perforation_colors"
    __table_args__ = (Index("ix_perforation_colors_rubro_order", "rubro_id", "sort_order"),)

    rubro_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project_rubros.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color_hex: Mapped[str] = mapped_column(String(12), nullable=False)
    checklist_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class PerforationPoint(UUIDPrimaryKeyMixin, Base):
    """A normalized point on a perforation document, including its live checklist."""

    __tablename__ = "perforation_points"
    __table_args__ = (
        Index("ix_perforation_points_document_page", "document_id", "page_number"),
        Index("ix_perforation_points_rubro_status", "rubro_id", "status"),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    rubro_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project_rubros.id", ondelete="CASCADE"), nullable=False
    )
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("perforation_documents.id", ondelete="CASCADE"), nullable=False
    )
    color_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("perforation_colors.id", ondelete="SET NULL"), nullable=True
    )
    page_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    x: Mapped[Decimal] = mapped_column(Numeric(8, 6), nullable=False)
    y: Mapped[Decimal] = mapped_column(Numeric(8, 6), nullable=False)
    diameter: Mapped[Decimal] = mapped_column(
        Numeric(8, 6), nullable=False, default=Decimal("0.026")
    )
    label: Mapped[str | None] = mapped_column(String(180), nullable=True)
    color_hex: Mapped[str] = mapped_column(String(12), nullable=False)
    checklist_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    note_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    note_storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    note_original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note_mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )


class PerforationAnnotation(UUIDPrimaryKeyMixin, Base):
    """A persisted pen stroke or text label on one page of a rubro document."""

    __tablename__ = "perforation_annotations"
    __table_args__ = (
        Index(
            "ix_perforation_annotations_document_page",
            "document_id",
            "page_number",
            "created_at",
        ),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    rubro_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project_rubros.id", ondelete="CASCADE"), nullable=False
    )
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("perforation_documents.id", ondelete="CASCADE"), nullable=False
    )
    page_number: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    points_json: Mapped[list] = mapped_column(JSON, nullable=False)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    color_hex: Mapped[str] = mapped_column(String(7), nullable=False)
    stroke_width: Mapped[int] = mapped_column(Integer, nullable=False)
    opacity: Mapped[Decimal] = mapped_column(Numeric(4, 3), nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class ElongationJob(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "elongation_jobs"
    __table_args__ = (
        Index("ix_elongation_company_project_created", "company_id", "project_id", "created_at"),
        UniqueConstraint(
            "company_id",
            "project_id",
            "idempotency_key",
            name="uq_elongation_job_source_template_sha",
        ),
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
    level_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("project_levels.id", ondelete="SET NULL"), nullable=True
    )
    responsible_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(220), nullable=False, default="Documento técnico")
    source_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="document")
    source_storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(130), nullable=True)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(25), nullable=False, default="uploaded")
    workflow_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="draft", server_default="draft"
    )
    template_mapping_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    processing_summary_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    tolerance_percent: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("7.00")
    )
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )
    theory_approved_by_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )
    theory_approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    approved_by_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    version_number: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
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
    label_number: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    raw_label: Mapped[str | None] = mapped_column(String(100), nullable=True)
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    classification: Mapped[str] = mapped_column(
        String(20), nullable=False, default="unknown", server_default="unknown"
    )
    length_m: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    strand_count: Mapped[int] = mapped_column(Integer, nullable=False)
    calculated_elongation: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    measured_elongation: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    review_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    theory_review_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
    field_confidence_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reviewed_by_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    source_file_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("elongation_job_files.id", ondelete="SET NULL"), nullable=True
    )
    source_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_location_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class ElongationJobFile(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "elongation_job_files"
    __table_args__ = (
        UniqueConstraint(
            "job_id", "kind", "version_number", name="uq_elongation_file_job_kind_ver"
        ),
        Index("ix_elongation_files_job_kind", "job_id", "kind"),
    )

    job_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("elongation_jobs.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    processing_status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="uploaded", server_default="uploaded"
    )
    processing_summary_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    uploaded_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class ElongationClassificationZone(UUIDPrimaryKeyMixin, Base):
    """A reviewer-defined normalized region used to apply a technical class in bulk."""

    __tablename__ = "elongation_classification_zones"
    __table_args__ = (Index("ix_elongation_zones_job", "job_id", "created_at"),)

    job_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("elongation_jobs.id", ondelete="CASCADE"), nullable=False
    )
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    geometry_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class ElongationMeasurement(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "elongation_measurements"
    __table_args__ = (
        UniqueConstraint("item_id", "ordinal", name="uq_elongation_measurement_item_ordinal"),
        Index("ix_elongation_measurements_job_item", "job_id", "item_id"),
    )

    job_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("elongation_jobs.id", ondelete="CASCADE"), nullable=False
    )
    item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("elongation_items.id", ondelete="CASCADE"), nullable=False
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    measured_elongation: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    match_method: Mapped[str | None] = mapped_column(String(30), nullable=True)
    review_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_file_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("elongation_job_files.id", ondelete="SET NULL"), nullable=True
    )
    source_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_location_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reviewed_by_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class ElongationExport(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "elongation_exports"
    __table_args__ = (
        UniqueConstraint(
            "job_id", "kind", "version_number", name="uq_elongation_export_job_kind_ver"
        ),
        Index("ix_elongation_exports_job_kind", "job_id", "kind"),
    )

    job_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("elongation_jobs.id", ondelete="CASCADE"), nullable=False
    )
    file_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("elongation_job_files.id", ondelete="RESTRICT"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


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


class PushSubscription(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "push_subscriptions"
    __table_args__ = (
        UniqueConstraint(
            "company_id", "user_id", "endpoint_hash", name="uq_push_company_user_endpoint"
        ),
        Index("ix_push_company_user_active", "company_id", "user_id", "is_active"),
        Index("ix_push_company_endpoint", "company_id", "endpoint_hash"),
    )

    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False
    )
    endpoint_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    p256dh: Mapped[str] = mapped_column(Text, nullable=False)
    auth: Mapped[str] = mapped_column(Text, nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
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
