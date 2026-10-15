import LoadingState from "@/components/base/LoadingState";
﻿import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '@/components/base/Button';
import Badge from '@/components/base/Badge';
import { Card, CardBody, CardHeader } from '@/components/base/Card';
import SearchInput from '@/components/base/SearchInput';
import Tabs from '@/components/base/Tabs';
import { useWorkspace } from '@/store/WorkspaceProvider';
import { useToast } from '@/components/base/Toast';
import BusinessRoutingActions, { type BusinessRoute } from './BusinessRoutingActions';

type Plan = { destination: string; summary: string; evidence: string[]; actions: string[]; confidence: number; owner_id?: string; due_at?: string; status: string };
type Candidate = { id: string; first_name?: string; last_name?: string; employer?: string; programme?: string; owner_id?: string; source?: string; business_plan?: Plan; business_route?: BusinessRoute };
export default function BusinessLeadPlanning({ section }: { section: 'commercial' | 'employers' }) {
  const { backendLoadedAt, userName } = useWorkspace();
  const { toast } = useToast();
  const [mode, setMode] = useState('matched');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [next, setNext] = useState('');
  const [rows, setRows] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!backendLoadedAt) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ section, mode, search, cursor, limit: '25' });
      void fetch(`/api/business/candidates?${params}`, { credentials: 'include', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) }).then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Lead planning could not be loaded.');
        if (!Array.isArray(result.items)) throw new Error('This workspace needs the business planning update.');
        if (!controller.signal.aborted) { setRows(result.items); setNext(result.next_cursor || ''); }
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Lead planning could not be loaded.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [backendLoadedAt, section, mode, search, cursor, revision]);
  const reset = () => { setCursor(''); setHistory([]); };
  const classify = async () => {
    setSaving(true); setAnalysisError('');
    try {
      const response = await fetch('/api/business/classify', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: rows.map(row => row.id) }), signal: AbortSignal.timeout(120000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'AI planning is unavailable. Existing plans were kept.');
      const plans = result.plans as { lead_id: string; plan: Plan }[];
      const counts = (route: string) => plans.filter(row => row.plan.destination === route || row.plan.destination === 'both').length;
      toast({ title: 'Lead plans saved', message: `${counts('commercial')} Commercial; ${counts('employers')} Employers; ${plans.filter(row => row.plan.destination === 'review').length} need review.`, tone: 'success' });
      setMode('review'); reset(); setRevision(value => value + 1);
    } catch (reason) { setAnalysisError(reason instanceof Error ? reason.message : 'AI planning failed. Please retry.'); }
    finally { setSaving(false); }
  };
  return <Card>
    <CardHeader title="Lead review & routing" icon="ri-sparkling-line" action={<Button size="sm" loading={saving} disabled={saving || loading || !!error || !rows.length} onClick={() => void classify()}>{saving ? 'Analysing displayed leads...' : 'AI: classify & plan displayed leads'}</Button>} />
    <CardBody className="space-y-4">
      <p className="text-sm text-foreground-500">Only your manual choices appear in Confirmed leads. AI reads recorded messages and notes to suggest a route and plan; it cannot confirm a contact or their funding eligibility. Routing saves a destination; commercial proposals and employer onboarding are recorded separately below.</p>
      <div className="flex flex-wrap items-center gap-3"><Tabs value={mode} onChange={value => { setMode(value); reset(); }} items={[{ value: 'matched', label: `Confirmed for ${section === 'commercial' ? 'Commercial' : 'Employers'}` }, { value: 'review', label: 'Needs review' }]} />
        <SearchInput value={search} onChange={value => { setSearch(value); reset(); }} placeholder="Search displayed lead queue..." />
      </div>
      {error && <div role="alert" className="space-y-2 text-sm text-red-700"><p>{error}</p><Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>Retry lead loading</Button></div>}
      {analysisError && <div role="alert" className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>{analysisError}</p><Button variant="outline" size="sm" loading={saving} disabled={saving || loading || !!error || !rows.length} onClick={() => void classify()}>Retry AI analysis</Button></div>}
      {loading ? <LoadingState className="text-sm">Loading lead plans...</LoadingState> : error ? null : !rows.length ? <div className="space-y-2 text-sm text-foreground-500"><p>{mode === 'matched' ? 'No manually confirmed leads in this section yet. Review a lead and choose its destination.' : 'No leads need review for these filters.'}</p>{mode === 'matched' && <Button size="sm" variant="outline" onClick={() => { setMode('review'); reset(); }}>Review unclassified leads</Button>}</div> : <div className="grid gap-3 lg:grid-cols-2">{rows.map(row => {
        const plan = row.business_plan;
        return <article key={row.id} className="space-y-3 rounded-lg border border-background-200 p-4">
          <div className="flex items-start justify-between gap-2"><div><Link to={`/leads/${encodeURIComponent(row.id)}`} className="font-semibold text-primary-700 hover:underline">{[row.first_name, row.last_name].filter(Boolean).join(' ') || row.id}</Link><p className="text-xs text-foreground-500">{row.employer || 'Employer not recorded'}{row.programme ? ` / ${row.programme}` : ''}</p></div><Badge tone={row.business_route?.source === 'manual' ? 'success' : 'warning'}>{row.business_route?.source === 'manual' ? 'Manually confirmed' : 'Needs review'}</Badge></div>
          <p className="text-xs text-foreground-500">Lead source: {row.source || 'Not recorded'}{plan ? ` · AI suggestion: ${plan.destination}` : ' · No AI suggestion'}</p>
          {plan ? <><p className="text-sm">{plan.summary}</p><div><p className="text-xs font-semibold text-foreground-500">Suggested plan</p><ol className="mt-1 list-inside list-decimal space-y-1 text-sm">{plan.actions.map((action, index) => <li key={index}>{action}</li>)}</ol></div>
            {plan.evidence.length > 0 && <details className="text-xs text-foreground-500"><summary className="cursor-pointer">Supporting evidence</summary>{plan.evidence.map((quote, index) => <blockquote key={index} className="mt-2 border-l-2 border-primary-200 pl-2">{quote}</blockquote>)}</details>}
            <p className="text-xs text-foreground-500">Owner: {userName(plan.owner_id || row.owner_id || '')} / {plan.due_at ? `Recorded follow-up: ${new Date(plan.due_at).toLocaleDateString()}` : 'Follow-up date not agreed'}</p>
          </> : <p className="text-sm text-foreground-500">Confirm this contact's role and training interest. AI classification will keep them here if evidence is missing.</p>}
          <BusinessRoutingActions leadId={row.id} initialRoute={row.business_route || null} onChanged={() => setRevision(value => value + 1)} />
        </article>;
      })}</div>}
      <div className="flex items-center justify-between"><Button variant="outline" size="sm" disabled={!history.length || loading || saving} onClick={() => { setCursor(history.at(-1) || ''); setHistory(value => value.slice(0, -1)); }}>Previous leads</Button><span className="text-xs text-foreground-500">Page {history.length + 1} / {rows.length} leads</span><Button variant="outline" size="sm" disabled={!next || loading || saving} onClick={() => { setHistory(value => [...value, cursor]); setCursor(next); }}>Next leads</Button></div>
    </CardBody>
  </Card>;
}
