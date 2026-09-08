from datetime import UTC, date, datetime

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import delete, select

from app.api.dependencies import CurrentCompanyAccess, DbSession
from app.api.routes.operations import (
    WORK_EDITOR_ROLES,
    add_activity,
    commit_or_conflict,
    flush_or_conflict,
    require_assignee,
    require_role,
)
from app.api.schemas.task_library import (
    DailyTaskChecklistPatch,
    DailyTaskChecklistResponse,
    DailyTaskCreate,
    DailyTaskPatch,
    DailyTaskResponse,
    DailyTaskTemplatePatch,
    DailyTaskTemplateResponse,
    TaskTemplateChecklistResponse,
    TaskTemplateCreate,
    TaskTemplatePatch,
    TaskTemplateResourceResponse,
    TaskTemplateResponse,
)
from app.db.models import (
    DailyTask,
    DailyTaskChecklistItem,
    DailyTaskTemplate,
    DailyTaskTemplateChecklistItem,
    InventoryItem,
    TaskTemplate,
    TaskTemplateChecklistItem,
    TaskTemplateRequirement,
)

router = APIRouter()


async def require_inventory_item(
    db: DbSession, company_id: str, item_id: str | None
) -> InventoryItem | None:
    if item_id is None:
        return None
    item = await db.scalar(
        select(InventoryItem).where(
            InventoryItem.id == item_id,
            InventoryItem.company_id == company_id,
        )
    )
    if item is None:
        raise HTTPException(status_code=422, detail="La herramienta no pertenece a la constructora")
    return item


async def require_template(
    db: DbSession, company_id: str, template_id: str
) -> TaskTemplate:
    template = await db.scalar(
        select(TaskTemplate).where(
            TaskTemplate.id == template_id,
            TaskTemplate.company_id == company_id,
        )
    )
    if template is None:
        raise HTTPException(status_code=404, detail="Tarea predeterminada no encontrada")
    return template


async def task_template_response(db: DbSession, template: TaskTemplate) -> TaskTemplateResponse:
    resource_rows = (
        await db.execute(
            select(TaskTemplateRequirement, InventoryItem)
            .outerjoin(InventoryItem, InventoryItem.id == TaskTemplateRequirement.inventory_item_id)
            .where(TaskTemplateRequirement.template_id == template.id)
            .order_by(TaskTemplateRequirement.sort_order, TaskTemplateRequirement.description)
        )
    ).all()
    checklist = list(
        (
            await db.execute(
                select(TaskTemplateChecklistItem)
                .where(TaskTemplateChecklistItem.template_id == template.id)
                .order_by(TaskTemplateChecklistItem.sort_order, TaskTemplateChecklistItem.title)
            )
        ).scalars()
    )
    return TaskTemplateResponse(
        id=template.id,
        company_id=template.company_id,
        title=template.title,
        description=template.description,
        task_type=template.task_type,
        priority=template.priority,
        default_location_text=template.default_location_text,
        is_active=template.is_active,
        created_by_user_id=template.created_by_user_id,
        created_at=template.created_at,
        updated_at=template.updated_at,
        resources=[
            TaskTemplateResourceResponse(
                id=requirement.id,
                inventory_item_id=requirement.inventory_item_id,
                description=requirement.description,
                required_quantity=requirement.required_quantity,
                unit=requirement.unit,
                sort_order=requirement.sort_order,
                inventory_code=item.code if item else None,
                inventory_name=item.name if item else None,
            )
            for requirement, item in resource_rows
        ],
        checklist_items=[
            TaskTemplateChecklistResponse(
                id=item.id,
                title=item.title,
                description=item.description,
                sort_order=item.sort_order,
            )
            for item in checklist
        ],
    )


async def replace_template_resources(
    db: DbSession,
    *,
    template_id: str,
    company_id: str,
    resources: list,
) -> None:
    await db.execute(
        delete(TaskTemplateRequirement).where(TaskTemplateRequirement.template_id == template_id)
    )
    for position, resource in enumerate(resources):
        item = await require_inventory_item(db, company_id, resource.inventory_item_id)
        db.add(
            TaskTemplateRequirement(
                template_id=template_id,
                inventory_item_id=item.id if item else None,
                description=resource.description.strip(),
                required_quantity=resource.required_quantity,
                unit=resource.unit.strip(),
                sort_order=resource.sort_order if resource.sort_order else position,
            )
        )


async def replace_template_checklist(
    db: DbSession,
    *,
    template_id: str,
    checklist_items: list,
) -> None:
    await db.execute(
        delete(TaskTemplateChecklistItem).where(
            TaskTemplateChecklistItem.template_id == template_id
        )
    )
    for position, item in enumerate(checklist_items):
        db.add(
            TaskTemplateChecklistItem(
                template_id=template_id,
                title=item.title.strip(),
                description=item.description.strip() if item.description else None,
                sort_order=item.sort_order if item.sort_order else position,
            )
        )


@router.get("/task-templates", response_model=list[TaskTemplateResponse])
async def list_task_templates(
    access: CurrentCompanyAccess,
    db: DbSession,
    active_only: bool = True,
) -> list[TaskTemplateResponse]:
    filters = [TaskTemplate.company_id == access.company_id]
    if active_only:
        filters.append(TaskTemplate.is_active.is_(True))
    templates = list(
        (
            await db.execute(
                select(TaskTemplate)
                .where(*filters)
                .order_by(TaskTemplate.is_active.desc(), TaskTemplate.title)
            )
        ).scalars()
    )
    return [await task_template_response(db, template) for template in templates]


@router.post(
    "/task-templates",
    response_model=TaskTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_task_template(
    payload: TaskTemplateCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> TaskTemplateResponse:
    require_role(access, WORK_EDITOR_ROLES)
    template = TaskTemplate(
        company_id=access.company_id,
        title=payload.title.strip(),
        description=payload.description.strip() if payload.description else None,
        task_type=payload.task_type,
        priority=payload.priority,
        default_location_text=(
            payload.default_location_text.strip() if payload.default_location_text else None
        ),
        created_by_user_id=access.user.id,
    )
    db.add(template)
    await flush_or_conflict(db, "No fue posible crear la tarea predeterminada")
    await replace_template_resources(
        db,
        template_id=template.id,
        company_id=access.company_id,
        resources=payload.resources,
    )
    await replace_template_checklist(
        db,
        template_id=template.id,
        checklist_items=payload.checklist_items,
    )
    add_activity(
        db,
        access,
        "task_template.created",
        "task_template",
        template.id,
        {"resources": len(payload.resources), "checklist_items": len(payload.checklist_items)},
    )
    await commit_or_conflict(db, "No fue posible crear la tarea predeterminada")
    await db.refresh(template)
    return await task_template_response(db, template)


@router.patch("/task-templates/{template_id}", response_model=TaskTemplateResponse)
async def update_task_template(
    template_id: str,
    payload: TaskTemplatePatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> TaskTemplateResponse:
    require_role(access, WORK_EDITOR_ROLES)
    template = await require_template(db, access.company_id, template_id)
    changes = payload.model_dump(exclude_unset=True)
    resources = changes.pop("resources", None)
    checklist_items = changes.pop("checklist_items", None)
    for field, value in changes.items():
        if field in {"title", "description", "default_location_text"} and isinstance(value, str):
            value = value.strip() or None
        setattr(template, field, value)
    if resources is not None:
        await replace_template_resources(
            db,
            template_id=template.id,
            company_id=access.company_id,
            resources=resources,
        )
    if checklist_items is not None:
        await replace_template_checklist(
            db,
            template_id=template.id,
            checklist_items=checklist_items,
        )
    add_activity(db, access, "task_template.updated", "task_template", template.id, changes)
    await commit_or_conflict(db, "No fue posible actualizar la tarea predeterminada")
    await db.refresh(template)
    return await task_template_response(db, template)


@router.delete("/task-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task_template(
    template_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Response:
    require_role(access, WORK_EDITOR_ROLES)
    template = await require_template(db, access.company_id, template_id)
    add_activity(db, access, "task_template.deleted", "task_template", template.id)
    await db.delete(template)
    await commit_or_conflict(db, "No fue posible eliminar la tarea predeterminada")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def can_manage_daily_tasks(access: CurrentCompanyAccess) -> bool:
    return access.role in WORK_EDITOR_ROLES


async def validate_daily_assignee(
    db: DbSession,
    access: CurrentCompanyAccess,
    assignee_id: str | None,
) -> str:
    target_id = assignee_id or access.user.id
    if not can_manage_daily_tasks(access) and target_id != access.user.id:
        raise HTTPException(
            status_code=403,
            detail="Solo puede gestionar sus propias tareas diarias",
        )
    await require_assignee(db, access.company_id, target_id)
    return target_id


async def daily_template_checklist(
    db: DbSession, template_id: str
) -> list[DailyTaskTemplateChecklistItem]:
    return list(
        (
            await db.execute(
                select(DailyTaskTemplateChecklistItem)
                .where(DailyTaskTemplateChecklistItem.template_id == template_id)
                .order_by(
                    DailyTaskTemplateChecklistItem.sort_order,
                    DailyTaskTemplateChecklistItem.title,
                )
            )
        ).scalars()
    )


async def daily_template_response(
    db: DbSession, template: DailyTaskTemplate
) -> DailyTaskTemplateResponse:
    items = await daily_template_checklist(db, template.id)
    return DailyTaskTemplateResponse(
        id=template.id,
        company_id=template.company_id,
        assigned_user_id=template.assigned_user_id,
        title=template.title,
        description=template.description,
        auto_renew_daily=template.auto_renew_daily,
        is_active=template.is_active,
        created_at=template.created_at,
        updated_at=template.updated_at,
        checklist_items=[
            TaskTemplateChecklistResponse(
                id=item.id,
                title=item.title,
                description=item.description,
                sort_order=item.sort_order,
            )
            for item in items
        ],
    )


async def daily_task_response(db: DbSession, task: DailyTask) -> DailyTaskResponse:
    items = list(
        (
            await db.execute(
                select(DailyTaskChecklistItem)
                .where(DailyTaskChecklistItem.daily_task_id == task.id)
                .order_by(DailyTaskChecklistItem.sort_order, DailyTaskChecklistItem.title)
            )
        ).scalars()
    )
    return DailyTaskResponse(
        id=task.id,
        company_id=task.company_id,
        template_id=task.template_id,
        assigned_user_id=task.assigned_user_id,
        task_date=task.task_date,
        title=task.title,
        description=task.description,
        status=task.status,
        created_at=task.created_at,
        updated_at=task.updated_at,
        checklist_items=[
            DailyTaskChecklistResponse(
                id=item.id,
                daily_task_id=item.daily_task_id,
                title=item.title,
                description=item.description,
                sort_order=item.sort_order,
                status=item.status,
                completed_at=item.completed_at,
            )
            for item in items
        ],
    )


async def create_daily_instance(
    db: DbSession,
    *,
    company_id: str,
    template: DailyTaskTemplate | None,
    assigned_user_id: str,
    task_date: date,
    title: str,
    description: str | None,
    checklist_items: list,
    created_by_user_id: str,
) -> DailyTask:
    task = DailyTask(
        company_id=company_id,
        template_id=template.id if template else None,
        assigned_user_id=assigned_user_id,
        task_date=task_date,
        title=title.strip(),
        description=description.strip() if description else None,
        created_by_user_id=created_by_user_id,
    )
    db.add(task)
    await db.flush()
    for position, item in enumerate(checklist_items):
        db.add(
            DailyTaskChecklistItem(
                daily_task_id=task.id,
                title=item.title.strip(),
                description=item.description.strip() if item.description else None,
                sort_order=item.sort_order if item.sort_order else position,
            )
        )
    return task


async def materialize_recurring_daily_tasks(
    db: DbSession,
    access: CurrentCompanyAccess,
    task_date: date,
) -> None:
    filters = [
        DailyTaskTemplate.company_id == access.company_id,
        DailyTaskTemplate.is_active.is_(True),
        DailyTaskTemplate.auto_renew_daily.is_(True),
    ]
    if not can_manage_daily_tasks(access):
        filters.append(DailyTaskTemplate.assigned_user_id == access.user.id)
    templates = list((await db.execute(select(DailyTaskTemplate).where(*filters))).scalars())
    if not templates:
        return
    template_ids = [template.id for template in templates]
    existing = set(
        (
            await db.scalars(
                select(DailyTask.template_id).where(
                    DailyTask.company_id == access.company_id,
                    DailyTask.task_date == task_date,
                    DailyTask.template_id.in_(template_ids),
                )
            )
        ).all()
    )
    created = False
    for template in templates:
        if template.id in existing:
            continue
        await create_daily_instance(
            db,
            company_id=access.company_id,
            template=template,
            assigned_user_id=template.assigned_user_id,
            task_date=task_date,
            title=template.title,
            description=template.description,
            checklist_items=await daily_template_checklist(db, template.id),
            created_by_user_id=template.created_by_user_id or access.user.id,
        )
        created = True
    if created:
        await commit_or_conflict(db, "No fue posible renovar las tareas diarias")


async def require_daily_task(
    db: DbSession, access: CurrentCompanyAccess, daily_task_id: str
) -> DailyTask:
    task = await db.scalar(
        select(DailyTask).where(
            DailyTask.id == daily_task_id,
            DailyTask.company_id == access.company_id,
        )
    )
    if task is None:
        raise HTTPException(status_code=404, detail="Tarea diaria no encontrada")
    if not can_manage_daily_tasks(access) and task.assigned_user_id != access.user.id:
        raise HTTPException(status_code=403, detail="Solo puede ver sus propias tareas diarias")
    return task


@router.get("/daily-task-templates", response_model=list[DailyTaskTemplateResponse])
async def list_daily_task_templates(
    access: CurrentCompanyAccess,
    db: DbSession,
    assigned_user_id: str | None = None,
) -> list[DailyTaskTemplateResponse]:
    target_id = await validate_daily_assignee(db, access, assigned_user_id)
    templates = list(
        (
            await db.execute(
                select(DailyTaskTemplate)
                .where(
                    DailyTaskTemplate.company_id == access.company_id,
                    DailyTaskTemplate.assigned_user_id == target_id,
                )
                .order_by(DailyTaskTemplate.is_active.desc(), DailyTaskTemplate.title)
            )
        ).scalars()
    )
    return [await daily_template_response(db, template) for template in templates]


@router.patch(
    "/daily-task-templates/{template_id}",
    response_model=DailyTaskTemplateResponse,
)
async def update_daily_task_template(
    template_id: str,
    payload: DailyTaskTemplatePatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> DailyTaskTemplateResponse:
    template = await db.scalar(
        select(DailyTaskTemplate).where(
            DailyTaskTemplate.id == template_id,
            DailyTaskTemplate.company_id == access.company_id,
        )
    )
    if template is None:
        raise HTTPException(status_code=404, detail="Tarea diaria predeterminada no encontrada")
    await validate_daily_assignee(db, access, template.assigned_user_id)
    changes = payload.model_dump(exclude_unset=True)
    checklist_items = changes.pop("checklist_items", None)
    for field, value in changes.items():
        if field in {"title", "description"} and isinstance(value, str):
            value = value.strip() or None
        setattr(template, field, value)
    if checklist_items is not None:
        await db.execute(
            delete(DailyTaskTemplateChecklistItem).where(
                DailyTaskTemplateChecklistItem.template_id == template.id
            )
        )
        for position, item in enumerate(checklist_items):
            db.add(
                DailyTaskTemplateChecklistItem(
                    template_id=template.id,
                    title=item.title.strip(),
                    description=item.description.strip() if item.description else None,
                    sort_order=item.sort_order if item.sort_order else position,
                )
            )
    add_activity(db, access, "daily_task_template.updated", "daily_task_template", template.id)
    await commit_or_conflict(db, "No fue posible actualizar la tarea diaria predeterminada")
    await db.refresh(template)
    return await daily_template_response(db, template)


@router.delete("/daily-task-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_daily_task_template(
    template_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Response:
    template = await db.scalar(
        select(DailyTaskTemplate).where(
            DailyTaskTemplate.id == template_id,
            DailyTaskTemplate.company_id == access.company_id,
        )
    )
    if template is None:
        raise HTTPException(status_code=404, detail="Tarea diaria predeterminada no encontrada")
    await validate_daily_assignee(db, access, template.assigned_user_id)
    add_activity(db, access, "daily_task_template.deleted", "daily_task_template", template.id)
    await db.delete(template)
    await commit_or_conflict(db, "No fue posible eliminar la tarea diaria predeterminada")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/daily-tasks", response_model=list[DailyTaskResponse])
async def list_daily_tasks(
    access: CurrentCompanyAccess,
    db: DbSession,
    task_date: date | None = None,
    assigned_user_id: str | None = None,
) -> list[DailyTaskResponse]:
    target_date = task_date or date.today()
    target_assignee = await validate_daily_assignee(db, access, assigned_user_id)
    await materialize_recurring_daily_tasks(db, access, target_date)
    tasks = list(
        (
            await db.execute(
                select(DailyTask)
                .where(
                    DailyTask.company_id == access.company_id,
                    DailyTask.assigned_user_id == target_assignee,
                    DailyTask.task_date == target_date,
                )
                .order_by(DailyTask.status, DailyTask.created_at)
            )
        ).scalars()
    )
    return [await daily_task_response(db, task) for task in tasks]


@router.post(
    "/daily-tasks",
    response_model=DailyTaskResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_daily_task(
    payload: DailyTaskCreate,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> DailyTaskResponse:
    assignee_id = await validate_daily_assignee(db, access, payload.assigned_user_id)
    template: DailyTaskTemplate | None = None
    if payload.save_as_template or payload.auto_renew_daily:
        template = DailyTaskTemplate(
            company_id=access.company_id,
            assigned_user_id=assignee_id,
            title=payload.title.strip(),
            description=payload.description.strip() if payload.description else None,
            auto_renew_daily=payload.auto_renew_daily,
            created_by_user_id=access.user.id,
        )
        db.add(template)
        await db.flush()
        for position, item in enumerate(payload.checklist_items):
            db.add(
                DailyTaskTemplateChecklistItem(
                    template_id=template.id,
                    title=item.title.strip(),
                    description=item.description.strip() if item.description else None,
                    sort_order=item.sort_order if item.sort_order else position,
                )
            )
    task = await create_daily_instance(
        db,
        company_id=access.company_id,
        template=template,
        assigned_user_id=assignee_id,
        task_date=payload.task_date,
        title=payload.title,
        description=payload.description,
        checklist_items=payload.checklist_items,
        created_by_user_id=access.user.id,
    )
    add_activity(
        db,
        access,
        "daily_task.created",
        "daily_task",
        task.id,
        {"template_id": template.id if template else None},
    )
    await commit_or_conflict(db, "No fue posible crear la tarea diaria")
    await db.refresh(task)
    return await daily_task_response(db, task)


@router.patch("/daily-tasks/{daily_task_id}", response_model=DailyTaskResponse)
async def update_daily_task(
    daily_task_id: str,
    payload: DailyTaskPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> DailyTaskResponse:
    task = await require_daily_task(db, access, daily_task_id)
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if field in {"title", "description"} and isinstance(value, str):
            value = value.strip() or None
        setattr(task, field, value)
    add_activity(db, access, "daily_task.updated", "daily_task", task.id, changes)
    await commit_or_conflict(db, "No fue posible actualizar la tarea diaria")
    await db.refresh(task)
    return await daily_task_response(db, task)


@router.patch(
    "/daily-tasks/{daily_task_id}/checklist/{item_id}",
    response_model=DailyTaskResponse,
)
async def update_daily_task_checklist(
    daily_task_id: str,
    item_id: str,
    payload: DailyTaskChecklistPatch,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> DailyTaskResponse:
    task = await require_daily_task(db, access, daily_task_id)
    item = await db.scalar(
        select(DailyTaskChecklistItem).where(
            DailyTaskChecklistItem.id == item_id,
            DailyTaskChecklistItem.daily_task_id == task.id,
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Control diario no encontrado")
    item.status = payload.status
    item.completed_at = (
        datetime.now(UTC).replace(tzinfo=None)
        if payload.status == "completed"
        else None
    )
    items = list(
        (
            await db.execute(
                select(DailyTaskChecklistItem.status).where(
                    DailyTaskChecklistItem.daily_task_id == task.id
                )
            )
        ).scalars()
    )
    if items and all(value == "completed" for value in items):
        task.status = "completed"
    elif any(value in {"completed", "in_progress"} for value in items):
        task.status = "in_progress"
    else:
        task.status = "pending"
    add_activity(
        db,
        access,
        "daily_task.checklist.updated",
        "daily_task_checklist_item",
        item.id,
        {"status": payload.status},
    )
    await commit_or_conflict(db, "No fue posible actualizar el control diario")
    await db.refresh(task)
    return await daily_task_response(db, task)


@router.delete("/daily-tasks/{daily_task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_daily_task(
    daily_task_id: str,
    access: CurrentCompanyAccess,
    db: DbSession,
) -> Response:
    task = await require_daily_task(db, access, daily_task_id)
    add_activity(db, access, "daily_task.deleted", "daily_task", task.id)
    await db.delete(task)
    await commit_or_conflict(db, "No fue posible eliminar la tarea diaria")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
