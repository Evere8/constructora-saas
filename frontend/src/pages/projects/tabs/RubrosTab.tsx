import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BarChart3,
  Cable,
  CheckSquare,
  ClipboardList,
  FileText,
  Layers3,
  MoreHorizontal,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/auth/useCan';
import { rubrosApi } from '@/lib/api/rubros';
import type { ProjectRubro, RubroFeatureKey } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { DocumentosTab } from '@/pages/projects/tabs/DocumentosTab';
import { TareasTab } from '@/pages/projects/tabs/TareasTab';
import { PerforationBoard } from '@/pages/projects/rubros/PerforationBoard';

const FEATURE_OPTIONS: Array<{ key: RubroFeatureKey; label: string; description: string; icon: typeof FileText }> = [
  { key: 'interactive_pdf', label: 'PDF interactivo', description: 'Carga planos, ubica puntos y gestiona checklist en el plano.', icon: Layers3 },
  { key: 'tasks', label: 'Tareas y checklist', description: 'Crea tareas vinculadas al rubro y usa sus controles.', icon: CheckSquare },
  { key: 'checklists', label: 'Checklist', description: 'Activa controles por actividad y por punto.', icon: ClipboardList },
  { key: 'observations', label: 'Observaciones', description: 'Registra notas rápidas del rubro.', icon: MoreHorizontal },
  { key: 'postensado_documentation', label: 'Documentación de Postensado', description: 'Lectura de planos, Excel teórico, mediciones y conciliación.', icon: Cable },
];

const rubroIcon = (rubro: ProjectRubro) => {
  if (rubro.slug === 'postensado') return Cable;
  if (rubro.slug === 'perforaciones') return Wrench;
  if (rubro.slug === 'gerenciamiento') return BarChart3;
  if (rubro.slug === 'diseno-estructural') return Layers3;
  return Sparkles;
};

function hasFeature(rubro: ProjectRubro, key: RubroFeatureKey): boolean {
  return rubro.features.some((feature) => feature.feature_key === key);
}

function FeatureCheckboxes({
  value,
  onChange,
  allowPostensadoDocumentation,
}: {
  value: RubroFeatureKey[];
  onChange: (value: RubroFeatureKey[]) => void;
  allowPostensadoDocumentation: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {FEATURE_OPTIONS.filter((option) => allowPostensadoDocumentation || option.key !== 'postensado_documentation').map((option) => {
        const Icon = option.icon;
        const checked = value.includes(option.key);
        return <label key={option.key} className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${checked ? 'border-primary bg-primary/5' : 'hover:border-primary/40'}`}><input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={checked} onChange={(event) => onChange(event.target.checked ? [...value, option.key] : value.filter((key) => key !== option.key))} /><span><span className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-primary" />{option.label}</span><span className="mt-1 block text-xs text-muted-foreground">{option.description}</span></span></label>;
      })}
    </div>
  );
}

function RubroEditorDialog({
  open,
  onOpenChange,
  companyId,
  projectId,
  rubro,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  projectId: string;
  rubro?: ProjectRubro | null;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(rubro?.name ?? '');
  const [description, setDescription] = useState(rubro?.description ?? '');
  const [features, setFeatures] = useState<RubroFeatureKey[]>(rubro?.features.map((feature) => feature.feature_key) ?? ['tasks', 'observations']);
  useEffect(() => {
    if (!open) return;
    setName(rubro?.name ?? '');
    setDescription(rubro?.description ?? '');
    setFeatures(rubro?.features.map((feature) => feature.feature_key) ?? ['tasks', 'observations']);
  }, [open, rubro]);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['project-rubros', companyId, projectId] });
  const save = useMutation({
    mutationFn: async () => {
      if (!rubro) return rubrosApi.create(companyId, projectId, { name: name.trim(), description: description.trim() || null, feature_keys: features });
      await rubrosApi.update(companyId, projectId, rubro.id, { name: name.trim(), description: description.trim() || null });
      return rubrosApi.setFeatures(companyId, projectId, rubro.id, features);
    },
    onSuccess: () => { toast.success(rubro ? 'Rubro actualizado' : 'Rubro creado'); invalidate(); onOpenChange(false); },
    onError: (error: Error) => toast.error(error.message),
  });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{rubro ? `Configurar ${rubro.name}` : 'Agregar rubro'}</DialogTitle></DialogHeader><div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="rubro-name">Nombre del rubro</Label><Input id="rubro-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Fachadas" /></div><div className="space-y-1.5"><Label htmlFor="rubro-description">Resumen</Label><Input id="rubro-description" value={description ?? ''} onChange={(event) => setDescription(event.target.value)} placeholder="Qué controla este rubro" /></div></div><div className="space-y-2"><Label>Funciones activas</Label><p className="text-xs text-muted-foreground">Puedes volver aquí en cualquier momento para agregar o quitar funciones.</p><FeatureCheckboxes value={features} onChange={setFeatures} allowPostensadoDocumentation={rubro?.slug === 'postensado'} /></div></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="button" disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>{rubro ? 'Guardar funciones' : 'Crear rubro'}</Button></DialogFooter></DialogContent></Dialog>;
}

function ObservationsPanel({ companyId, projectId, rubro }: { companyId: string; projectId: string; rubro: ProjectRubro }) {
  const canEdit = useCan('projects.edit');
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const query = useQuery({ queryKey: ['rubro-observations', companyId, projectId, rubro.id], queryFn: ({ signal }) => rubrosApi.listObservations(companyId, projectId, rubro.id, signal) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['rubro-observations', companyId, projectId, rubro.id] });
  const create = useMutation({ mutationFn: () => rubrosApi.createObservation(companyId, projectId, rubro.id, body.trim()), onSuccess: () => { setBody(''); toast.success('Observación registrada'); refresh(); }, onError: (error: Error) => toast.error(error.message) });
  const remove = useMutation({ mutationFn: (id: string) => rubrosApi.removeObservation(companyId, projectId, rubro.id, id), onSuccess: refresh, onError: (error: Error) => toast.error(error.message) });
  return <Card className="surface-solid"><CardHeader><CardTitle className="text-base">Observaciones del rubro</CardTitle><CardDescription>Notas rápidas visibles para el equipo de esta obra.</CardDescription></CardHeader><CardContent className="space-y-3">{canEdit ? <div className="space-y-2"><Textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Escribe una observación, decisión o pendiente" /><div className="flex justify-end"><Button size="sm" disabled={!body.trim() || create.isPending} onClick={() => create.mutate()}><Plus className="h-4 w-4" /> Guardar observación</Button></div></div> : null}<div className="space-y-2">{query.data?.length ? query.data.map((observation) => <div key={observation.id} className="group flex gap-3 rounded-xl border bg-muted/25 p-3"><p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">{observation.body}</p>{canEdit ? <button type="button" aria-label="Eliminar observación" className="h-fit rounded p-1 text-muted-foreground opacity-70 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100" onClick={() => remove.mutate(observation.id)}><Trash2 className="h-4 w-4" /></button> : null}</div>) : <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Todavía no hay observaciones en este rubro.</p>}</div></CardContent></Card>;
}

export function RubrosTab({ companyId, projectId }: { companyId: string; projectId: string }) {
  const canEdit = useCan('projects.edit');
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['project-rubros', companyId, projectId], queryFn: ({ signal }) => rubrosApi.list(companyId, projectId, signal) });
  const rubros = useMemo(() => query.data ?? [], [query.data]);
  const [selectedRubroId, setSelectedRubroId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRubro, setEditingRubro] = useState<ProjectRubro | null>(null);
  const selected = selectedRubroId ? rubros.find((rubro) => rubro.id === selectedRubroId) ?? null : null;
  const deleteRubro = useMutation({
    mutationFn: (rubroId: string) => rubrosApi.remove(companyId, projectId, rubroId),
    onSuccess: () => { toast.success('Rubro eliminado'); setSelectedRubroId(null); void queryClient.invalidateQueries({ queryKey: ['project-rubros', companyId, projectId] }); },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    if (selectedRubroId && !rubros.some((rubro) => rubro.id === selectedRubroId)) {
      setSelectedRubroId(null);
    }
  }, [rubros, selectedRubroId]);

  if (query.isLoading) return <Card className="surface-solid"><CardContent className="p-6 text-sm text-muted-foreground">Preparando rubros de la obra…</CardContent></Card>;
  if (query.isError) return <Card className="surface-solid"><CardContent className="space-y-3 p-6"><p className="font-semibold text-destructive">No se pudieron cargar los rubros.</p><Button size="sm" variant="outline" onClick={() => void query.refetch()}>Reintentar</Button></CardContent></Card>;

  return <div className="space-y-5">
    <div className={selected ? 'hidden' : 'flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'}><div><h2 className="text-xl font-bold tracking-tight">Rubros de la obra</h2><p className="text-sm text-muted-foreground">Toca un rubro para entrar a su pantalla y ver solo sus funciones.</p></div>{canEdit ? <Button onClick={() => { setEditingRubro(null); setEditorOpen(true); }}><Plus className="h-4 w-4" /> Agregar rubro</Button> : null}</div>
    <div className={selected ? 'hidden' : 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'}>{rubros.map((rubro) => { const Icon = rubroIcon(rubro); const pointsPercent = rubro.summary.points_total ? Math.round((rubro.summary.points_completed / rubro.summary.points_total) * 100) : null; return <button type="button" key={rubro.id} onClick={() => setSelectedRubroId(rubro.id)} className="surface-glass group rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-start justify-between gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span><Badge variant={rubro.is_system ? 'muted' : 'info'}>{rubro.is_system ? 'Predeterminado' : 'Personalizado'}</Badge></div><p className="mt-4 font-semibold">{rubro.name}</p><p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">{rubro.description || 'Funciones configurables para esta especialidad.'}</p><div className="mt-3 flex flex-wrap gap-1.5">{rubro.features.slice(0, 3).map((feature) => <span key={feature.id} className="rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">{FEATURE_OPTIONS.find((option) => option.key === feature.feature_key)?.label ?? feature.feature_key}</span>)}</div><div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-xs"><span><strong className="block text-base text-foreground">{rubro.summary.tasks_completed}/{rubro.summary.tasks_total}</strong>Tareas</span><span><strong className="block text-base text-foreground">{rubro.summary.documents_total}</strong>Planos</span><span><strong className="block text-base text-foreground">{pointsPercent === null ? '—' : `${pointsPercent}%`}</strong>Puntos</span></div><span className="mt-3 block text-xs font-semibold text-primary">Abrir rubro →</span></button>; })}</div>
    {selected ? <section className="space-y-4"><Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => setSelectedRubroId(null)}><ArrowLeft className="h-4 w-4" /> Volver a rubros</Button><Card className="surface-glass"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">{(() => { const Icon = rubroIcon(selected); return <Icon className="h-5 w-5" />; })()}</span><div><h3 className="text-lg font-bold">{selected.name}</h3><p className="text-sm text-muted-foreground">{selected.description || 'Rubro configurado para esta obra.'}</p></div></div>{canEdit ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setEditingRubro(selected); setEditorOpen(true); }}><Settings2 className="h-4 w-4" /> Funciones</Button>{!selected.is_system ? <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { if (window.confirm(`¿Eliminar el rubro ${selected.name}?`)) deleteRubro.mutate(selected.id); }}><Trash2 className="h-4 w-4" /> Eliminar</Button> : null}</div> : null}</CardContent></Card>
      {hasFeature(selected, 'postensado_documentation') ? <DocumentosTab companyId={companyId} projectId={projectId} /> : null}
      {hasFeature(selected, 'interactive_pdf') ? <PerforationBoard companyId={companyId} projectId={projectId} rubro={selected} /> : null}
      {hasFeature(selected, 'tasks') ? <Card className="surface-glass"><CardHeader><CardTitle className="text-base">Tareas de {selected.name}</CardTitle><CardDescription>Las tareas creadas aquí quedan vinculadas a este rubro y también aparecen en la pestaña Tareas de la obra.</CardDescription></CardHeader><CardContent><TareasTab companyId={companyId} projectId={projectId} rubroId={selected.id} /></CardContent></Card> : null}
      {hasFeature(selected, 'observations') ? <ObservationsPanel companyId={companyId} projectId={projectId} rubro={selected} /> : null}
      {hasFeature(selected, 'checklists') && !hasFeature(selected, 'interactive_pdf') && !hasFeature(selected, 'tasks') ? <Card className="surface-solid"><CardContent className="p-5 text-sm text-muted-foreground">Activa Tareas o PDF interactivo para aplicar checklist a una actividad o punto concreto.</CardContent></Card> : null}
    </section> : null}
    <RubroEditorDialog open={editorOpen} onOpenChange={setEditorOpen} companyId={companyId} projectId={projectId} rubro={editingRubro} />
  </div>;
}
