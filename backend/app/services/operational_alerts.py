from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select

from app.api.dependencies import DbSession
from app.db.models import (
    ChecklistItem,
    InventoryItem,
    Notification,
    Project,
    Task,
    TaskMaterialRequirement,
)


@dataclass(frozen=True)
class AlertCandidate:
    dedupe_key: str
    alert_type: str
    severity: str
    title: str
    message: str
    project_id: str | None = None
    task_id: str | None = None
    checklist_item_id: str | None = None
    requirement_id: str | None = None
    assigned_user_id: str | None = None
    due_at: datetime | None = None


def due_severity(due_at: datetime, now: datetime) -> tuple[str, str]:
    remaining = due_at - now
    if remaining.total_seconds() < 0:
        return "critical", "venció"
    if remaining <= timedelta(hours=24):
        return "warning", "vence en menos de 24 horas"
    return "info", "vence en menos de 48 horas"


def derive_requirement_availability(
    item: InventoryItem | None,
    project_id: str,
    required_quantity: Decimal,
) -> str:
    if item is None:
        return "unchecked"
    if item.status in {"maintenance", "retired"} or item.current_project_id != project_id:
        return "missing"
    if item.quantity < required_quantity:
        return "partial"
    return "available"


async def refresh_linked_requirement_availability(
    db: DbSession,
    company_id: str,
) -> None:
    """Keep linked task requirements aligned with the live inventory location and stock."""
    rows = (
        await db.execute(
            select(TaskMaterialRequirement, Task, InventoryItem)
            .join(Task, Task.id == TaskMaterialRequirement.task_id)
            .outerjoin(InventoryItem, InventoryItem.id == TaskMaterialRequirement.inventory_item_id)
            .where(
                Task.company_id == company_id,
                TaskMaterialRequirement.inventory_item_id.is_not(None),
            )
        )
    ).all()
    for requirement, task, item in rows:
        requirement.availability_status = derive_requirement_availability(
            item,
            task.project_id,
            requirement.required_quantity,
        )
    await db.flush()


async def collect_alert_candidates(
    db: DbSession,
    company_id: str,
    *,
    now: datetime | None = None,
) -> list[AlertCandidate]:
    current = (now or datetime.now(UTC)).replace(tzinfo=None)
    horizon = current + timedelta(hours=48)
    candidates: list[AlertCandidate] = []

    task_rows = (
        await db.execute(
            select(Task, Project.name)
            .join(Project, Project.id == Task.project_id)
            .where(
                Task.company_id == company_id,
                Task.status.not_in(("completed", "cancelled")),
                Task.due_at.is_not(None),
                Task.due_at <= horizon,
            )
        )
    ).all()
    for task, project_name in task_rows:
        severity, timing = due_severity(task.due_at, current)
        candidates.append(
            AlertCandidate(
                dedupe_key=f"task_due:{task.id}",
                alert_type="task_due",
                severity=severity,
                title=f"Tarea {timing}",
                message=f"{task.title} · {project_name}",
                project_id=task.project_id,
                task_id=task.id,
                assigned_user_id=task.assigned_user_id,
                due_at=task.due_at,
            )
        )
        if task.assigned_user_id is None:
            candidates.append(
                AlertCandidate(
                    dedupe_key=f"task_unassigned:{task.id}",
                    alert_type="task_unassigned",
                    severity="warning",
                    title="Tarea próxima sin responsable",
                    message=f"{task.title} · {project_name}",
                    project_id=task.project_id,
                    task_id=task.id,
                    due_at=task.due_at,
                )
            )

    checklist_rows = (
        await db.execute(
            select(ChecklistItem, Project.name)
            .join(Project, Project.id == ChecklistItem.project_id)
            .where(
                ChecklistItem.company_id == company_id,
                ChecklistItem.status.not_in(("completed", "not_applicable")),
                ChecklistItem.due_at.is_not(None),
                ChecklistItem.due_at <= horizon,
            )
        )
    ).all()
    for item, project_name in checklist_rows:
        severity, timing = due_severity(item.due_at, current)
        candidates.append(
            AlertCandidate(
                dedupe_key=f"checklist_due:{item.id}",
                alert_type="checklist_due",
                severity=severity,
                title=f"Control {timing}",
                message=f"{item.title} · {project_name}",
                project_id=item.project_id,
                task_id=item.task_id,
                checklist_item_id=item.id,
                assigned_user_id=item.assigned_user_id,
                due_at=item.due_at,
            )
        )

    requirement_rows = (
        await db.execute(
            select(TaskMaterialRequirement, Task, Project.name)
            .join(Task, Task.id == TaskMaterialRequirement.task_id)
            .join(Project, Project.id == Task.project_id)
            .where(
                Task.company_id == company_id,
                Task.status.not_in(("completed", "cancelled")),
                Task.due_at.is_not(None),
                Task.due_at <= horizon,
                TaskMaterialRequirement.availability_status != "available",
            )
        )
    ).all()
    for requirement, task, project_name in requirement_rows:
        severity = "critical" if requirement.availability_status == "missing" else "warning"
        candidates.append(
            AlertCandidate(
                dedupe_key=f"requirement_risk:{requirement.id}",
                alert_type="requirement_risk",
                severity=severity,
                title="Recurso faltante para tarea próxima",
                message=f"{requirement.description} · {task.title} · {project_name}",
                project_id=task.project_id,
                task_id=task.id,
                requirement_id=requirement.id,
                assigned_user_id=task.assigned_user_id,
                due_at=task.due_at,
            )
        )

    maintenance_rows = (
        await db.execute(
            select(InventoryItem).where(
                InventoryItem.company_id == company_id,
                InventoryItem.status == "maintenance",
            )
        )
    ).scalars()
    for item in maintenance_rows:
        candidates.append(
            AlertCandidate(
                dedupe_key=f"inventory_maintenance:{item.id}",
                alert_type="inventory_maintenance",
                severity="warning",
                title="Equipo en mantenimiento",
                message=f"{item.code} · {item.name}",
                project_id=item.current_project_id,
            )
        )
    return candidates


async def sync_company_alerts(
    db: DbSession,
    company_id: str,
    *,
    now: datetime | None = None,
) -> None:
    current = (now or datetime.now(UTC)).replace(tzinfo=None)
    await refresh_linked_requirement_availability(db, company_id)
    candidates = await collect_alert_candidates(db, company_id, now=current)
    existing = list(
        (
            await db.execute(
                select(Notification).where(
                    Notification.company_id == company_id,
                    Notification.resolved_at.is_(None),
                )
            )
        ).scalars()
    )
    by_key = {notification.dedupe_key: notification for notification in existing}
    active_keys = {candidate.dedupe_key for candidate in candidates}

    for notification in existing:
        if notification.dedupe_key not in active_keys:
            notification.resolved_at = current

    for candidate in candidates:
        notification = by_key.get(candidate.dedupe_key)
        if notification is None:
            db.add(Notification(company_id=company_id, **candidate.__dict__))
            continue
        for field, value in candidate.__dict__.items():
            setattr(notification, field, value)
        notification.resolved_at = None

    await db.flush()
