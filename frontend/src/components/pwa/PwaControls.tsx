import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BellRing, Check, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useCompany } from '@/context/CompanyProvider';
import { pushApi } from '@/lib/api/push';
import { Button } from '@/components/ui/button';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function applicationServerKey(value: string): Uint8Array {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function PwaControls() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ios = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  const standalone = typeof window !== 'undefined' && ((typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const configQuery = useQuery({ queryKey: ['push-config', companyId], queryFn: ({ signal }) => pushApi.config(companyId, signal), enabled: Boolean(companyId) && supported, staleTime: 5 * 60_000 });

  useEffect(() => {
    const listener = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', listener);
    return () => window.removeEventListener('beforeinstallprompt', listener);
  }, []);
  useEffect(() => {
    let cancelled = false;
    setSubscribed(false);
    if (!supported || !companyId || !configQuery.data?.enabled) return () => { cancelled = true; };
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then(async (subscription) => {
        if (!subscription) return;
        // A browser subscription is shared by the installed app. Register the
        // same endpoint for every active company the user opens so switching
        // companies cannot silently stop its task notifications.
        await pushApi.save(companyId, subscription.toJSON());
        if (!cancelled) setSubscribed(true);
      })
      .catch(() => { if (!cancelled) setSubscribed(false); });
    return () => { cancelled = true; };
  }, [supported, companyId, configQuery.data?.enabled]);

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      if (!configQuery.data?.enabled || !configQuery.data.public_key) throw new Error('Las notificaciones todavía no están habilitadas en el servidor.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('El navegador no autorizó las notificaciones.');
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(configQuery.data.public_key) });
      await pushApi.save(companyId, subscription.toJSON());
      return subscription;
    },
    onSuccess: () => { setSubscribed(true); toast.success('Notificaciones activadas en este dispositivo'); },
    onError: (error: Error) => toast.error(error.message),
  });

  const install = async () => {
    if (!installPrompt) {
      if (ios) toast.info('En Safari toca Compartir y luego “Agregar a pantalla de inicio”.');
      return;
    }
    await installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === 'accepted') toast.success('Obrixapy se está instalando');
    setInstallPrompt(null);
  };

  return <div className="flex items-center gap-1">
    {installPrompt || (ios && !standalone) ? <Button size="sm" variant="outline" aria-label="Instalar Obrixapy" onClick={() => void install()}><Download className="h-4 w-4" /><span className="hidden sm:inline">Instalar</span></Button> : null}
    {supported && configQuery.data?.enabled ? <Button size="sm" variant={subscribed ? 'secondary' : 'outline'} disabled={subscribed || subscribeMutation.isPending} onClick={() => subscribeMutation.mutate()} title={subscribed ? 'Notificaciones activas' : 'Activar notificaciones'}>{subscribed ? <Check className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}<span className="hidden sm:inline">{subscribed ? 'Avisos activos' : 'Activar avisos'}</span></Button> : null}
  </div>;
}
