import { test, expect, type Page } from '@playwright/test';

async function gesture(page: Page, type: 'touch' | 'pen', x: number, y: number, dx = 0, dy = 0) {
  const cdp = await page.context().newCDPSession(page);
  if (type === 'touch') {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 6, y: y + dy * i / 6, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', button: 'left', buttons: 1, clickCount: 1, x, y });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', button: 'left', buttons: 1, x: x + dx * i / 6, y: y + dy * i / 6 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', button: 'left', buttons: 0, clickCount: 1, x: x + dx, y: y + dy });
  }
  await cdp.detach();
}

test.beforeEach(async ({ page, request }) => {
  await request.post('/__qa/reset');
  await page.goto('/e2e/index.html');
  await expect(page.getByAltText('Plano de perforaciones Nivel QA')).toBeVisible();
  await page.getByRole('button', { name: 'Pantalla completa', exact: true }).click();
});

test('touch/pen tools do not pan; marks survive reload; eraser removes marks', async ({ page, request }) => {
  const canvas = page.getByAltText('Plano de perforaciones Nivel QA').locator('..');
  const initial = await canvas.getAttribute('style');
  await page.getByRole('button', { name: 'Lápiz', exact: true }).click();
  await gesture(page, 'touch', 100, 600, 180, 100);
  await expect.poll(async () => (await (await request.get('/__qa/state')).json()).annotations.length).toBe(1);
  expect(await canvas.getAttribute('style')).toBe(initial);
  await page.getByRole('button', { name: 'Trazo recto', exact: true }).click();
  await gesture(page, 'pen', 400, 600, 150, 100);
  await expect.poll(async () => (await (await request.get('/__qa/state')).json()).annotations.length).toBe(2);
  const marks = (await (await request.get('/__qa/state')).json()).annotations;
  expect(marks[1].points).toHaveLength(2);
  expect(marks[1].points[0].x).toBeCloseTo(400 / 768, 2);
  expect(await canvas.getAttribute('style')).toBe(initial);
  await page.reload();
  await page.getByRole('button', { name: 'Pantalla completa', exact: true }).click();
  await expect(page.locator('svg polyline')).toHaveCount(2);
  await page.getByRole('button', { name: 'Borrador', exact: true }).click();
  await gesture(page, 'touch', 100, 600);
  await expect.poll(async () => (await (await request.get('/__qa/state')).json()).annotations.length).toBe(1);
});

test('failed annotation upload is retained and retried after reload, without duplicates', async ({ page, request }) => {
  await page.route('**/__qa/annotations', route => route.abort());
  await page.getByRole('button', { name: 'Lápiz', exact: true }).click();
  await gesture(page, 'pen', 100, 600, 200, 50);
  await expect(page.getByRole('status')).toContainText('1 marcas pendientes');
  await page.unroute('**/__qa/annotations');
  page.on('dialog', dialog => dialog.accept());
  await page.reload();
  await expect.poll(async () => (await (await request.get('/__qa/state')).json()).annotations.length).toBe(1);
  await expect(page.getByText('Todas las marcas guardadas')).toBeVisible();
  await page.reload();
  expect((await (await request.get('/__qa/state')).json()).annotations).toHaveLength(1);
});

test('point popup can be dragged from blank padding with a pen and closed on a small screen', async ({ page }) => {
  await page.getByRole('button', { name: 'Punto', exact: true }).click();
  await gesture(page, 'touch', 300, 700);
  const panel = page.getByRole('region', { name: 'Detalle del punto' });
  await expect(panel).toBeVisible();
  const before = (await panel.boundingBox())!;
  await gesture(page, 'pen', before.x + 4, before.y + 50, before.x > 100 ? -70 : 70, -60);
  const after = (await panel.boundingBox())!;
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(20);
  await expect(page.getByRole('button', { name: 'Cerrar detalle del punto' })).toBeInViewport();
  await page.getByRole('button', { name: 'Cerrar detalle del punto' }).click();
  await expect(panel).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['Mover', 'Punto', 'Lápiz', 'Iluminador', 'Trazo recto', 'Borrador']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Salir', exact: true })).toBeInViewport();
});

test('Mover is clamped to PDF bounds, and inventory drag works with touch', async ({ page }) => {
  await page.getByRole('button', { name: 'Acercar plano' }).click();
  await gesture(page, 'touch', 500, 650, -350, -200);
  const canvas = page.getByAltText('Plano de perforaciones Nivel QA').locator('..');
  const transform = await canvas.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41);
  expect(transform).toBeLessThanOrEqual(0);
  expect(transform).toBeGreaterThanOrEqual(-154);
  await gesture(page, 'touch', 100, 600, 600, 150);
  expect(await canvas.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41)).toBe(0);
  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  const inventory = page.getByTestId('inventory');
  await inventory.scrollIntoViewIfNeeded();
  const handle = (await page.getByRole('button', { name: 'Arrastrar Taladro H-1' }).boundingBox())!;
  const dest = (await page.locator('[data-inventory-destination="project-qa"]').boundingBox())!;
  await gesture(page, 'touch', handle.x + 10, handle.y + 10, dest.x + 70 - handle.x - 10, dest.y + 70 - handle.y - 10);
  await expect(page.locator('[data-inventory-destination="project-qa"]')).toContainText('Taladro');
});
