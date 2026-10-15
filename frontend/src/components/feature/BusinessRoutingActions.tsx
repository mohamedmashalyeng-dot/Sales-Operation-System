import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '@/components/base/Button';
import LoadingState from '@/components/base/LoadingState';
import { useWorkspace } from '@/store/WorkspaceProvider';

export type BusinessRoute = { destination: 'commercial' | 'employers'; source: 'manual'; status: 'Confirmed'; reviewed_by: string; reviewed_by_name?: string; reviewed_at: string };

export default function BusinessRoutingActions({ leadId, initialRoute, onChanged }: {
  leadId: string; initialRoute?: BusinessRoute | null; onChanged?: () => void;
}) {
  const { backendLoadedAt, userName } = useWorkspace();
  const [route, setRoute] = useState(initialRoute || null);
  const [loading, setLoading] = useState(initialRoute === undefined);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (initialRoute !== undefined) { setRoute(initialRoute); setLoading(false); return; }
    if (!backendLoadedAt) return;
    const controller = new AbortController();
    setRoute(null); setLoading(true); setError('');
    void fetch(`/api/leads/${encodeURIComponent(leadId)}/business-route`, { credentials: 'include', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load routing.');
        if (!controller.signal.aborted) setRoute(result.route);
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load routing.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [leadId, initialRoute, backendLoadedAt, revision]);
  const confirm = async (destination: 'commercial' | 'employers') => {
    setSaving(destination); setError('');
    try {
      const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}/business-route`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination }), signal: AbortSignal.timeout(30000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Routing could not be saved.');
      setRoute(result.route); onChanged?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Routing could not be saved. Please retry.'); }
    finally { setSaving(''); }
  };
  return <div className="space-y-2" data-business-routing={leadId}>
    <p className="text-xs text-foreground-500">After reviewing the contact, choose their destination. AI suggestions require your confirmation.</p>
    {loading ? <LoadingState inline>Loading routing...</LoadingState> : <>
      {route?.source === 'manual' && <p className="text-xs text-green-700" role="status">Confirmed for <Link className="font-semibold underline" to={`/${route.destination}`}>{route.destination === 'commercial' ? 'Commercial' : 'Employers'}</Link> by {route.reviewed_by_name || userName(route.reviewed_by)} · {new Date(route.reviewed_at).toLocaleString()}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" loading={saving === 'commercial'} disabled={!!saving || route?.destination === 'commercial'} onClick={() => void confirm('commercial')} leftIcon={<i className="ri-briefcase-line" />}>Send to Commercial</Button>
        <Button size="sm" variant="outline" loading={saving === 'employers'} disabled={!!saving || route?.destination === 'employers'} onClick={() => void confirm('employers')} leftIcon={<i className="ri-building-line" />}>Send to Employers</Button>
      </div>
    </>}
    {error && <div role="alert" className="text-xs text-red-700">{error} <Button size="xs" variant="ghost" onClick={() => setRevision(value => value + 1)}>Reload routing</Button></div>}
  </div>;
}
