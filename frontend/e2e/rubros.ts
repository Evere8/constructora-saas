async function request(route: string, method = 'GET', body?: unknown) {
  const response = await fetch(`/__qa/${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error('Transferencia interrumpida');
  return response.json();
}
export const rubrosApi = {
  perforationWorkspace: () => request('state'),
  previewPerforationDocument: async () => new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="1000" height="1400" fill="white"/><path d="M100 100H900V1300H100Z M100 700H900" fill="none" stroke="black"/></svg>'], { type: 'image/svg+xml' }),
  createPerforationAnnotation: (_c: string, _p: string, _r: string, body: unknown) => request('annotations', 'POST', body),
  deletePerforationAnnotation: (_c: string, _p: string, _r: string, id: string) => request(`annotations/${id}`, 'DELETE'),
  createPerforationPoint: (_c: string, _p: string, _r: string, body: unknown) => request('points', 'POST', body),
};
