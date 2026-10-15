import LoadingState from "@/components/base/LoadingState";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import Drawer from "@/components/base/Drawer";
import { callJourneyApi } from "@/store/callJourney";
import { formatDateTime } from "@/utils/format";

type Detail = { meeting: Record<string, any>; attendees: { id: string; name: string; email: string; lead_id: string | null; status: string; attended_at: string | null }[];
  total: number; has_more: boolean; next_offset: number };
function joinLink(value: unknown): string | null {
  try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
export default function MeetingDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<Detail | null>(null); const [error, setError] = useState('');
  const [offset, setOffset] = useState(0); const [loading, setLoading] = useState(true); const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void callJourneyApi<Detail>(`/api/zoom/meetings/${encodeURIComponent(id)}?offset=${offset}`, undefined, controller.signal)
      .then(row => { if (!controller.signal.aborted) setData(current => ({ ...row, attendees: offset && current ? [...current.attendees, ...row.attendees] : row.attendees })); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, offset, reload]);
  const meeting = data?.meeting;
  const url = joinLink(meeting?.meeting_link || meeting?.zoom_link || meeting?.join_url);
  const start = meeting?.start_at && Number.isFinite(Date.parse(meeting.start_at)) ? formatDateTime(meeting.start_at) : 'Not recorded';
  return <Drawer open onClose={onClose} title={meeting?.topic || meeting?.name || meeting?.title || 'Zoom meeting'}
    subtitle={meeting?.zoom_meeting_id ? `Meeting ID ${meeting.zoom_meeting_id}` : 'Meeting details'} widthClass="max-w-xl">
    {error ? <div role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}<Button size="sm" variant="outline" className="ml-2" onClick={() => setReload(value => value + 1)}>Retry meeting</Button></div> : null}
    {loading && !data ? <LoadingState>Loading meeting details...</LoadingState> : null}
    {data && meeting ? <div className="space-y-5">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Field label="Host" value={meeting.zoom_host_label || meeting.zoom_host_id || 'Not recorded'} />
        <Field label="Account" value={meeting.zoom_account_label || meeting.zoom_account_id || 'Not recorded'} />
        <Field label="Start" value={start} />
        <Field label="Duration" value={meeting.duration ? `${meeting.duration} minutes` : 'Not recorded'} />
        <Field label="Status" value={meeting.status || meeting.zoom_list_type || 'Not recorded'} />
        <Field label="Recorded attendees" value={String(data.total)} />
      </dl>
      {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"><i className="ri-vidicon-line" /> Join Zoom meeting</a>
        : <p className="text-sm text-foreground-500">No join link is available for this meeting.</p>}
      <div><h3 className="font-semibold text-foreground-900">Attendees</h3><p className="mt-1 text-xs text-foreground-500">Attendance is shown only when it has been recorded.</p>
        {data.attendees.length ? <ul className="mt-3 divide-y divide-background-200">{data.attendees.map(attendee => <li key={attendee.id} className="space-y-1 py-3 text-sm">
          <p className="font-semibold">{attendee.name || attendee.email || 'Unnamed attendee'}</p>
          {attendee.email ? <p className="break-all text-xs text-foreground-500">{attendee.email}</p> : null}
          <Badge tone={attendee.attended_at ? 'success' : 'neutral'}>{attendee.attended_at ? `Attended · ${formatDateTime(attendee.attended_at)}` : attendee.status || 'Attendance not recorded'}</Badge>
          {attendee.lead_id ? <Link className="ml-2 text-xs font-semibold text-primary-700 hover:underline" to={`/leads/${encodeURIComponent(attendee.lead_id)}`}>Open lead</Link> : null}
        </li>)}</ul> : <p className="mt-3 text-sm text-foreground-500">No attendees have been recorded.</p>}
        {data.has_more ? <Button className="mt-3" size="sm" variant="outline" loading={loading} disabled={loading} onClick={() => setOffset(data.next_offset)}>Load more attendees</Button> : null}
      </div>
    </div> : null}
  </Drawer>;
}
function Field({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-foreground-500">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-foreground-900">{value}</dd></div>; }
