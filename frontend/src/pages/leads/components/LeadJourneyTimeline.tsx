import { useState } from "react";
import { Link } from "react-router-dom";
import Modal from "@/components/base/Modal";
import Badge from "@/components/base/Badge";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { JourneyData, StageTransition } from "@/store/callJourney";
import { formatDateTime } from "@/utils/format";

const STAGES = [
  ['new', 'New Lead'], ['contacted', 'Contacted'], ['qualified', 'Qualified'], ['interested', 'Interested'],
  ['application', 'Application'], ['signed', 'Signed'], ['enrolled', 'Enrolled']
];
const baseline = (row?: StageTransition | null) => Boolean(row && /first observed|baseline/i.test(row.reason));
const shortDate = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
const SOURCES: Record<string, string> = { manual: 'Manual', call_analysis: 'Call analysis', application: 'Application', system_rule: 'System rule' };

export default function LeadJourneyTimeline({ data }: { data: JourneyData }) {
  const { userName } = useWorkspace();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const milestones = data.journey_milestones || STAGES.map(([key, label]) => ({ key, label, transition: null }));
  const selected = milestones.find(row => row.key === selectedKey);
  const currentIndex = milestones.findIndex(row => row.key === data.journey_current_key);
  const reachedAt = (index: number) => (currentIndex >= 0 && index <= currentIndex) || Boolean(milestones[index]?.transition);
  return <section aria-label="Lead journey timeline" className="rounded-xl border border-background-200 bg-background-50 p-4 sm:p-5">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-heading text-base font-bold text-foreground-950">Lead Journey</h3>
        <p className="mt-1 text-xs text-foreground-500">Select a reached stage to view its recorded transition.</p></div>
      {data.journey_closed ? <Badge tone="danger">Journey closed · {data.current_stage}</Badge> : <Badge tone="primary">Current: {data.journey_current_stage || 'Not recorded'}</Badge>}
    </div>
    <div className="overflow-x-auto pb-3" tabIndex={0} aria-label="Scrollable journey stages">
      <ol className="flex min-w-[630px] py-2" aria-label="Lead journey">
        {milestones.map((milestone, index) => {
          const current = milestone.key === data.journey_current_key;
          const reached = reachedAt(index);
          const completed = reached && !current;
          const future = !reached;
          const previousReached = index > 0 && reachedAt(index - 1);
          const row = milestone.transition;
          return <li key={milestone.key} className="relative flex min-w-[90px] flex-1 flex-col items-center text-center" aria-current={current ? 'step' : undefined}>
            {index > 0 ? <span aria-hidden="true" className={`absolute right-1/2 top-5 h-0.5 w-full ${reached && previousReached ? 'bg-primary-500' : 'bg-background-200'}`} /> : null}
            <button type="button" disabled={future} aria-label={`${milestone.label}: ${current ? 'current stage' : completed ? 'completed stage' : 'not recorded'}`}
              onClick={() => setSelectedKey(milestone.key)}
              className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 text-base transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-200 ${current
                ? 'border-primary-600 bg-primary-600 text-white shadow-md ring-4 ring-primary-100'
                : completed ? 'border-primary-500 bg-primary-50 text-primary-700 hover:bg-primary-100' : 'border-background-300 bg-background-50 text-foreground-300'}`}>
              <i aria-hidden="true" className={current ? 'ri-radio-button-line' : completed ? 'ri-check-line' : 'ri-circle-line'} />
            </button>
            <span className={`mt-3 text-xs font-bold ${future ? 'text-foreground-400' : 'text-foreground-900'}`}>{milestone.label}</span>
            <span className={`mt-1 text-[11px] ${current ? 'font-semibold text-primary-700' : 'text-foreground-500'}`}>{current ? (data.journey_closed ? 'Last recorded stage' : 'Current') : completed ? 'Reached' : 'Not recorded'}</span>
            {row && !baseline(row) ? <time className="mt-1 text-[11px] text-foreground-500" dateTime={row.created_at}>{shortDate(row.created_at)}</time>
              : reached ? <span className="mt-1 text-[11px] text-foreground-400">Reached date unavailable</span> : null}
          </li>;
        })}
      </ol>
    </div>
    {selected ? <Modal open onClose={() => setSelectedKey(null)} size="md" title={`${selected.label} stage details`}>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <Detail label="Stage" value={selected.transition?.to_stage || selected.label} />
        <Detail label="Reached at" value={selected.transition && !baseline(selected.transition) ? formatDateTime(selected.transition.created_at) : 'Not recorded'} />
        <Detail label="Changed by" value={selected.transition?.approved_by ? userName(selected.transition.approved_by) : selected.transition?.source === 'system_rule' ? 'KBC system' : 'Not recorded'} />
        <Detail label="Source" value={selected.transition ? SOURCES[selected.transition.source] || selected.transition.source : 'Not recorded'} />
        <div className="sm:col-span-2"><Detail label="Reason" value={selected.transition?.reason || 'No transition history is available for this stage.'} /></div>
      </dl>
      {selected.transition && baseline(selected.transition) ? <p className="mt-4 text-xs text-foreground-500">First observed {formatDateTime(selected.transition.created_at)}. The original reached date is unknown.</p> : null}
      {selected.transition?.call_id ? <Link className="mt-4 inline-block text-sm font-semibold text-primary-700 hover:underline" to={`/zoom/calls/${encodeURIComponent(selected.transition.call_id)}`}>Open related Zoom call</Link> : null}
    </Modal> : null}
  </section>;
}
function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-foreground-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap font-semibold text-foreground-900">{value}</dd></div>; }
