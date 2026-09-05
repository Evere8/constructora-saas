import csv
from collections import Counter
from datetime import UTC, date, datetime, time, timedelta
from io import StringIO

from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import select

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.schemas.alerts import (
    ReportAdvancedResponse,
    ReportAssigneeRow,
    ReportProjectRow,
    ReportStatusCount,
)
from app.db.models import (
    AppUser,
    ChecklistItem,
    Project,
    Task,
    TaskMaterialRequirement,
)
from app.services.operational_alerts import refresh_linked_requirement_availability

router = APIRouter()


def date_bounds(
    date_from: date | None, date_to: date | None
) -> tuple[datetime | None, datetime | None]:
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="La fecha inicial no puede superar la final")
    start = datetime.combine(date_from, time.min) if date_from else None
    end = datetime.combine(date_to, time.max) if date_to else None
    return start, end


async def build_advanced_report(
    db: DbSession,
    company_id: str,
    *,
    project_id: str | None,
    assigned_user_id: str | None,
    date_from: date | None,
    date_to: date | None,
) -> ReportAdvancedResponse:
    start, end = date_bounds(date_from, date_to)
    await refresh_linked_requirement_availability(db, company_id)
    filters = [Task.company_id == company_id]
    if project_id:
        filters.append(Task.project_id == project_id)
    if assigned_user_id:
        filters.append(Task.assigned_user_id == assigned_user_id)
    if start:
        filters.append(Task.due_at >= start)
    if end:
        filters.append(Task.due_at <= end)

    rows = (
        await db.execute(
            select(Task, Project.name, AppUser.full_name, AppUser.email)
            .join(Project, Project.id == Task.project_id)
            .outerjoin(AppUser, AppUser.id == Task.assigned_user_id)
            .where(*filters)
            .order_by(Task.due_at.is_(None), Task.due_at)
        )
    ).all()
    tasks = [row[0] for row in rows]
    current = datetime.now(UTC).replace(tzinfo=None)
    due_horizon = current + timedelta(hours=48)
    incomplete = {"pending", "in_progress", "review"}
    completed = sum(task.status == "completed" for task in tasks)
    overdue = sum(
        bool(task.due_at and task.due_at < current and task.status in incomplete) for task in tasks
    )
    due_soon = sum(
        bool(task.due_at and current <= task.due_at <= due_horizon and task.status in incomplete)
        for task in tasks
    )

    checklist_filters = [ChecklistItem.company_id == company_id]
    if project_id:
        checklist_filters.append(ChecklistItem.project_id == project_id)
    if assigned_user_id:
        checklist_filters.append(ChecklistItem.assigned_user_id == assigned_user_id)
    if start:
        checklist_filters.append(ChecklistItem.due_at >= start)
    if end:
        checklist_filters.append(ChecklistItem.due_at <= end)
    checklist = list((await db.execute(select(ChecklistItem).where(*checklist_filters))).scalars())

    risk_filters = [
        Task.company_id == company_id,
        TaskMaterialRequirement.availability_status != "available",
        Task.status.not_in(("completed", "cancelled")),
    ]
    if project_id:
        risk_filters.append(Task.project_id == project_id)
    if assigned_user_id:
        risk_filters.append(Task.assigned_user_id == assigned_user_id)
    if start:
        risk_filters.append(Task.due_at >= start)
    if end:
        risk_filters.append(Task.due_at <= end)
    risk_requirements = list(
        (
            await db.execute(
                select(TaskMaterialRequirement)
                .join(Task, Task.id == TaskMaterialRequirement.task_id)
                .where(*risk_filters)
            )
        ).scalars()
    )

    project_groups: dict[str, dict[str, object]] = {}
    assignee_groups: dict[str, dict[str, object]] = {}
    for task, project_name, full_name, email in rows:
        project = project_groups.setdefault(
            task.project_id,
            {"name": project_name, "total": 0, "completed": 0, "overdue": 0},
        )
        project["total"] = int(project["total"]) + 1
        project["completed"] = int(project["completed"]) + (task.status == "completed")
        project["overdue"] = int(project["overdue"]) + bool(
            task.due_at and task.due_at < current and task.status in incomplete
        )

        assignee_key = task.assigned_user_id or "unassigned"
        assignee = assignee_groups.setdefault(
            assignee_key,
            {
                "user_id": task.assigned_user_id,
                "name": full_name or email or "Sin responsable",
                "total": 0,
                "completed": 0,
                "overdue": 0,
            },
        )
        assignee["total"] = int(assignee["total"]) + 1
        assignee["completed"] = int(assignee["completed"]) + (task.status == "completed")
        assignee["overdue"] = int(assignee["overdue"]) + bool(
            task.due_at and task.due_at < current and task.status in incomplete
        )

    def percent(done: int, total: int) -> float:
        return round(done / total * 100, 2) if total else 0

    projects = [
        ReportProjectRow(
            project_id=key,
            project_name=str(value["name"]),
            tasks_total=int(value["total"]),
            tasks_completed=int(value["completed"]),
            tasks_overdue=int(value["overdue"]),
            completion_percent=percent(int(value["completed"]), int(value["total"])),
        )
        for key, value in project_groups.items()
    ]
    assignees = [
        ReportAssigneeRow(
            user_id=value["user_id"] if isinstance(value["user_id"], str) else None,
            name=str(value["name"]),
            tasks_total=int(value["total"]),
            tasks_completed=int(value["completed"]),
            tasks_overdue=int(value["overdue"]),
            completion_percent=percent(int(value["completed"]), int(value["total"])),
        )
        for value in assignee_groups.values()
    ]
    projects.sort(key=lambda row: (-row.tasks_overdue, row.project_name))
    assignees.sort(key=lambda row: (-row.tasks_overdue, row.name))
    statuses = Counter(task.status for task in tasks)
    return ReportAdvancedResponse(
        date_from=date_from,
        date_to=date_to,
        project_id=project_id,
        assigned_user_id=assigned_user_id,
        tasks_total=len(tasks),
        tasks_completed=completed,
        tasks_overdue=overdue,
        tasks_due_soon=due_soon,
        tasks_unassigned=sum(task.assigned_user_id is None for task in tasks),
        checklist_total=len(checklist),
        checklist_completed=sum(item.status == "completed" for item in checklist),
        checklist_blocked=sum(item.status == "blocked" for item in checklist),
        requirements_at_risk=len(risk_requirements),
        completion_percent=percent(completed, len(tasks)),
        status_counts=[
            ReportStatusCount(status=status_name, count=count)
            for status_name, count in sorted(statuses.items())
        ],
        projects=projects,
        assignees=assignees,
    )


@router.get("/reports/advanced", response_model=ReportAdvancedResponse)
async def advanced_report(
    access: CurrentCompanyAccess,
    db: DbSession,
    project_id: str | None = None,
    assigned_user_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> ReportAdvancedResponse:
    return await build_advanced_report(
        db,
        access.company_id,
        project_id=project_id,
        assigned_user_id=assigned_user_id,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/reports/advanced.csv")
async def advanced_report_csv(
    access: CurrentCompanyAccess,
    db: DbSession,
    project_id: str | None = None,
    assigned_user_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Response:
    report = await build_advanced_report(
        db,
        access.company_id,
        project_id=project_id,
        assigned_user_id=assigned_user_id,
        date_from=date_from,
        date_to=date_to,
    )
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["Reporte avanzado de Obrixapy"])
    writer.writerow(["Tareas", report.tasks_total])
    writer.writerow(["Completadas", report.tasks_completed])
    writer.writerow(["Vencidas", report.tasks_overdue])
    writer.writerow(["Próximas 48 h", report.tasks_due_soon])
    writer.writerow(["Recursos en riesgo", report.requirements_at_risk])
    writer.writerow([])
    writer.writerow(["Obra", "Tareas", "Completadas", "Vencidas", "Avance %"])
    for project in report.projects:
        writer.writerow(
            [
                project.project_name,
                project.tasks_total,
                project.tasks_completed,
                project.tasks_overdue,
                project.completion_percent,
            ]
        )
    writer.writerow([])
    writer.writerow(["Responsable", "Tareas", "Completadas", "Vencidas", "Avance %"])
    for assignee in report.assignees:
        writer.writerow(
            [
                assignee.name,
                assignee.tasks_total,
                assignee.tasks_completed,
                assignee.tasks_overdue,
                assignee.completion_percent,
            ]
        )
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="reporte-obrixapy.csv"'},
    )
