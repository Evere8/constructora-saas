import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useAnnotationOutbox, type AnnotationInput } from '../useAnnotationOutbox';
import type { PerforationAnnotation } from '@/types/api';

const mark: AnnotationInput = { document_id: 'document', page_number: 1, kind: 'line', points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }], color_hex: '#111827', stroke_width: 2, opacity: 1 };
const saved = (input: AnnotationInput) => ({ ...input, id: input.client_id } as PerforationAnnotation);
beforeEach(() => localStorage.clear());

it('retains a failed stroke across remount and reuses its idempotency key', async () => {
  const offline = vi.fn().mockRejectedValue(new Error('sin conexión'));
  const first = renderHook(() => useAnnotationOutbox('user:company:rubro', offline, vi.fn()));
  act(() => first.result.current.enqueue([mark]));
  await waitFor(() => expect(first.result.current.error).toBe('sin conexión'));
  const id = first.result.current.pending[0].client_id;
  expect(JSON.parse(localStorage.getItem('user:company:rubro')!)[0].client_id).toBe(id);
  first.unmount();
  const online = vi.fn(async (input: AnnotationInput) => saved(input));
  const second = renderHook(() => useAnnotationOutbox('user:company:rubro', online, vi.fn()));
  await waitFor(() => expect(second.result.current.pending).toHaveLength(0));
  expect(online).toHaveBeenCalledWith(expect.objectContaining({ client_id: id }));
  expect(localStorage.getItem('user:company:rubro')).toBeNull();
});

it('late acknowledgements from an unmounted board do not erase newly queued strokes', async () => {
  let finish!: (value: PerforationAnnotation) => void;
  const pendingRequest = new Promise<PerforationAnnotation>(resolve => { finish = resolve; });
  const first = renderHook(() => useAnnotationOutbox('same-board', () => pendingRequest, vi.fn()));
  act(() => first.result.current.enqueue([mark]));
  const firstMark = first.result.current.pending[0];
  first.unmount();
  const second = renderHook(() => useAnnotationOutbox('same-board', vi.fn().mockRejectedValue(new Error('offline')), vi.fn()));
  act(() => second.result.current.enqueue([mark]));
  await act(async () => finish(saved(firstMark)));
  expect(JSON.parse(localStorage.getItem('same-board')!)).toHaveLength(2);
  expect(second.result.current.pending).toHaveLength(2);
});

it('never sends a different account queue', async () => {
  localStorage.setItem('old-user', JSON.stringify([{ ...mark, client_id: crypto.randomUUID() }]));
  const send = vi.fn();
  const hook = renderHook(() => useAnnotationOutbox('new-user', send, vi.fn()));
  expect(hook.result.current.pending).toHaveLength(0);
  expect(send).not.toHaveBeenCalled();
  expect(localStorage.getItem('old-user')).not.toBeNull();
});
