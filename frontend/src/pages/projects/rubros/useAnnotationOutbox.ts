import { useCallback, useEffect, useRef, useState } from 'react';
import { rubrosApi } from '@/lib/api/rubros';
import type { PerforationAnnotation } from '@/types/api';

export type AnnotationInput = Parameters<typeof rubrosApi.createPerforationAnnotation>[3];
type Pending = AnnotationInput & { client_id: string };

function readQueue(key: string): Pending[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(stored) ? stored.filter((item) => item && typeof item.client_id === 'string' && Array.isArray(item.points)) : [];
  } catch { return []; }
}

// The owning component is keyed by user/company/project/rubro. Never replay one
// user's cached work under a different user or tenant.
export function useAnnotationOutbox(key: string, send: (input: AnnotationInput) => Promise<PerforationAnnotation>, onSaved: (mark: PerforationAnnotation) => void) {
  const [pending, setPending] = useState<Pending[]>(() => readQueue(key));
  const queue = useRef(pending);
  const sending = useRef(false);
  const mounted = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [durable, setDurable] = useState(true);
  const callbacks = useRef({ send, onSaved });
  callbacks.current = { send, onSaved };
  const persist = useCallback((value: Pending[]) => {
    queue.current = value;
    if (mounted.current) setPending(value);
    try {
      if (value.length) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key);
      if (mounted.current) setDurable(true);
    } catch { if (mounted.current) setDurable(false); }
  }, [key]);
  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      while (queue.current.length && mounted.current) {
        const input = queue.current[0];
        const saved = await callbacks.current.send(input);
        // A request can finish after this board was unmounted. Leave the
        // durable queue intact then: a new instance will retry the same UUID.
        // Never overwrite newer strokes that instance may already have queued.
        if (!mounted.current) break;
        persist(queue.current.filter((item) => item.client_id !== input.client_id));
        callbacks.current.onSaved(saved);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'No se pudo guardar la marca');
    } finally { sending.current = false; if (mounted.current) setBusy(false); }
  }, [persist]);
  useEffect(() => {
    mounted.current = true;
    void flush();
    const online = () => void flush();
    const warn = (event: BeforeUnloadEvent) => { if (queue.current.length) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('online', online);
    window.addEventListener('beforeunload', warn);
    return () => { mounted.current = false; window.removeEventListener('online', online); window.removeEventListener('beforeunload', warn); };
  }, [flush]);
  const enqueue = (inputs: AnnotationInput[]) => {
    persist([...queue.current, ...inputs.map((input) => ({ ...input, client_id: crypto.randomUUID() }))]);
    void flush();
  };
  return { pending, error, busy, durable, enqueue, retry: () => void flush() };
}
