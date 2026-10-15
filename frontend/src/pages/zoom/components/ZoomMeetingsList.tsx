import LoadingState from "@/components/base/LoadingState";
import { useEffect, useRef, useState } from "react";
import Button from "@/components/base/Button";
import { Card, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import SearchInput from "@/components/base/SearchInput";
import Select from "@/components/base/Select";
import { callJourneyApi } from "@/store/callJourney";
import { mapBackendMeeting } from "@/store/backendSync";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { Meeting } from "@/store/types";
import MeetingTable from "./MeetingTable";

export default function ZoomMeetingsList({ onOpen }: { onOpen: (meeting: Meeting) => void }) {
  const { state, userName } = useWorkspace();
  const users = useRef(state.users); users.current = state.users;
  const [scope, setScope] = useState('all'); const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState(''); const [previous, setPrevious] = useState<string[]>([]);
  const [next, setNext] = useState(''); const [rows, setRows] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  const cutoff = useRef(new Date().toISOString());
  const reset = () => { setCursor(''); setPrevious([]); };
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ limit: '50', ...(cursor ? { cursor } : {}), ...(search.trim() ? { search: search.trim() } : {}),
        ...(scope === 'upcoming' ? { start_from: cutoff.current } : scope === 'past' ? { start_to: cutoff.current } : {}) });
      void callJourneyApi<{ items: Record<string, any>[]; next_cursor: string }>(`/api/meetings?${query}`, undefined, controller.signal)
        .then(page => { if (!controller.signal.aborted) { setRows((page.items || []).map(row => mapBackendMeeting(row, users.current))); setNext(page.next_cursor || ''); } })
        .catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [scope, search, cursor, reload]);
  return <Card>
    <CardHeader title="Zoom meetings" icon="ri-vidicon-line" subtitle="Browse recorded meetings and open their details"
      action={<Button variant="outline" size="sm" loading={loading} disabled={loading} onClick={() => setReload(value => value + 1)}>Refresh meetings</Button>} />
    <div className="flex flex-wrap items-end gap-3 border-b border-background-200 p-4">
      <Select className="w-full sm:w-44" label="Show meetings" value={scope} onChange={value => { reset(); setScope(value); }}
        options={[{ value: 'all', label: 'All meetings' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }]} />
      <div className="min-w-0 flex-1"><label className="mb-1.5 block text-xs font-semibold text-foreground-500">Search meetings</label>
        <SearchInput value={search} onChange={value => { reset(); setSearch(value); }} placeholder="Search topic, host or meeting ID" /></div>
    </div>
    {error ? <div role="alert" className="p-4 text-sm text-red-700">{error}<Button className="ml-3" size="sm" variant="outline" onClick={() => setReload(value => value + 1)}>Retry meetings</Button></div>
      : loading ? <LoadingState className="p-5 text-sm">Loading Zoom meetings...</LoadingState>
      : rows.length ? <MeetingTable meetings={rows} onOpen={onOpen} hostName={userName} eventName={() => undefined} />
      : <EmptyState icon="ri-vidicon-line" title="No meetings match" message="Meetings will appear after Zoom is synced. Try another date range or search." />}
    <div className="flex items-center justify-between gap-3 border-t border-background-200 p-4">
      <p className="text-xs text-foreground-500">Page {previous.length + 1} · {rows.length} meetings shown</p>
      <div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading || !previous.length} onClick={() => { setCursor(previous[previous.length - 1]); setPrevious(value => value.slice(0, -1)); }}>Previous meetings</Button>
        <Button size="sm" variant="outline" disabled={loading || Boolean(error) || !next} onClick={() => { setPrevious(value => [...value, cursor]); setCursor(next); }}>Next meetings</Button></div>
    </div>
  </Card>;
}
