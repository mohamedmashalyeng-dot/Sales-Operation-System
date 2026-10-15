import LoadingState, { Spinner } from "@/components/base/LoadingState";
import { useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "@/components/base/Avatar";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardHeader } from "@/components/base/Card";
import TodayFilters, { DEFAULT_FILTERS, type TodayFilterState } from "./components/TodayFilters";
import { useTodayOverview } from "./useTodayOverview";
import { PipelineChart, SalesPerformance, SparkBars, dailyValues, changeLabel } from "./components/TodayCharts";
import { useWorkspace } from "@/store/WorkspaceProvider";

const number = (value: number) => value.toLocaleString();
export default function Today() {
  const { currentUser } = useWorkspace();
  const [filters, setFilters] = useState<TodayFilterState>({ ...DEFAULT_FILTERS });
  const [months, setMonths] = useState(6);
  const { data, loading, error, retry } = useTodayOverview(filters, months);
  const visible = loading || error ? null : data;
  const total = (kind: string, field: "current" | "previous" | "snapshot" | "today" | "overdue" = "current") => visible?.totals[kind]?.[field] || 0;
  const value = (n: number | null, suffix = "") => visible && n !== null ? `${number(n)}${suffix}` : "—";
  const now = new Date(data?.as_of || Date.now());
  const dateLabel = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";
  const period = filters.range === "week" ? "this week" : filters.range === "year" ? "this year" : "this month";
  const sla = total("sla_total") ? Math.round(total("sla_good") / total("sla_total") * 100) : null;
  const options = (key: "programme" | "intake" | "source", all: string) => [{ value: "all", label: all }, ...(data?.options[key] || []).map(v => ({ value: v, label: v }))];
  const cards = [
    { label: "New Leads", value: value(total("leads")), icon: "ri-user-add-line", tone: "purple", kind: "leads", note: changeLabel(total("leads"), total("leads", "previous")), title: "Leads created in the selected period, compared with the same elapsed time in the previous period." },
    { label: "Follow-ups Due Today", value: value(total("followups", "today")), icon: "ri-calendar-check-line", tone: "gold", kind: "followups", note: `${number(total("followups", "overdue"))} overdue`, title: "Open follow-ups from approved call analysis. Overdue means due before today; daily bars show open tasks by their due date." },
    { label: "Applications in Progress", value: value(total("active", "snapshot")), icon: "ri-file-list-3-line", tone: "purple", kind: "active", note: "Active applications · all dates", title: "Current applications excluding enrolled, rejected, withdrawn, cancelled and lost records. Daily bars show when these active applications were created." },
    { label: "Closed Won / Enrolled", value: value(total("enrolled")), icon: "ri-graduation-cap-line", tone: "green", kind: "enrolled", note: changeLabel(total("enrolled"), total("enrolled", "previous")), title: "Distinct learners enrolled or won in the selected period, using recorded enrolment dates or actual stage changes. Undated outcomes are excluded from period totals." },
    { label: "Response SLA", value: value(sla, "%"), icon: "ri-timer-line", tone: "gold", kind: "sla", note: sla === null ? "No SLA samples in this period" : `${number(total("sla_good"))} of ${number(total("sla_total"))} within ${data?.sla_hours || 48}h`, title: "Incoming external emails received in the selected period that have a response or have passed the response deadline. Pending emails still within the deadline are excluded." },
  ];
  const tones: Record<string, string> = { purple: "bg-primary-100 text-primary-600", gold: "bg-accent-100 text-accent-900", green: "bg-green-100 text-green-600" };
  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5 px-3 py-5 md:px-6 md:py-7" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-4 pb-1">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-100 text-2xl text-accent-800"><i className="ri-sun-line" /></span>
          <div><h1 className="font-heading text-2xl font-bold tracking-tight text-foreground-950 md:text-[28px]">{greeting}, {currentUser.name.split(" ")[0]}</h1>
            <p className="mt-1 text-xs text-foreground-500 md:text-sm">Here’s what’s happening with your admissions and sales activity today.</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="mr-2 flex items-center gap-2 rounded-md border border-background-200 bg-background-50 px-3 py-2.5"><i className="ri-calendar-line text-primary-500" />{dateLabel}</span>
          <div className="flex gap-1" aria-label="Performance period">{[["week", "This Week"], ["month", "This Month"], ["year", "This Year"]].map(([key, label]) => <button key={key} aria-pressed={filters.range === key} onClick={() => setFilters({ ...filters, range: key })} className={`rounded-full px-3.5 py-2 font-medium transition-colors ${filters.range === key ? "bg-primary-600 text-white" : "text-foreground-600 hover:bg-primary-50"}`}>{label}</button>)}</div>
        </div>
      </div>
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"><span>Unable to load Today: {error}</span><Button size="sm" variant="secondary" onClick={retry}>Retry</Button></div>}
      <SalesPerformance data={visible} range={filters.range} programme={filters.programme} loading={loading} onRefresh={retry} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(card => <Card key={card.label} className="min-w-0 p-4">
          <div className="flex items-start justify-between gap-2"><span className={`flex h-8 w-8 items-center justify-center rounded-md ${tones[card.tone]}`}><i className={card.icon} /></span><SparkBars values={visible ? dailyValues(visible, card.kind, 7) : []} tone={card.tone} /></div>
          <p className="mt-2 font-heading text-[26px] font-bold leading-8 text-foreground-950" data-today-metric={card.kind}>{card.value}</p>
          <p className="mt-0.5 text-[13px] text-foreground-800" title={card.title}>{card.label}</p>
          <p className={`mt-1.5 text-[11px] ${card.kind === "followups" && total("followups", "overdue") ? "text-red-600" : "text-foreground-500"}`} title={card.title}>{visible ? card.note : loading ? <LoadingState inline>Loading…</LoadingState> : "Unavailable"}</p>
        </Card>)}
      </div>
      <TodayFilters filters={filters} onChange={setFilters} programmeOptions={options("programme", "All programmes")} intakeOptions={options("intake", "All intakes")} sourceOptions={options("source", "All sources")} ownerOptions={[{ value: "all", label: "All permitted owners" }, ...(data?.options.owner || [])]} />
      <div className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="min-w-0">
          <CardHeader title="Leads & Applications Pipeline" subtitle="Monthly acquisition, applications and enrolments" icon="ri-bar-chart-grouped-line" action={<select aria-label="Pipeline period" className="max-w-[120px] rounded-md border border-background-200 bg-background-50 p-1.5 text-xs text-foreground-700" value={months} onChange={e => setMonths(Number(e.target.value))}><option value={3}>Last 3 Months</option><option value={6}>Last 6 Months</option><option value={12}>Last 12 Months</option></select>} />
          <PipelineChart data={visible} months={months} loading={loading} />
        </Card>
        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="Priority Leads" subtitle="Active leads with high priority or an overdue follow-up" icon="ri-contacts-book-2-line" iconTone="accent" action={<Link className="flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" to="/leads">View all <i className="ri-arrow-right-s-line" /></Link>} />
          <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="border-b border-background-200 bg-background-100/50 text-[10px] uppercase tracking-wide text-foreground-500"><tr>{["Name", "Programme", "Source", "Status", "Priority", "Owner"].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
            <tbody>{visible?.priority.map(lead => <tr key={lead.id} className="border-b border-background-200 last:border-0 hover:bg-primary-50/30"><td className="px-4 py-4"><Link to={`/leads/${encodeURIComponent(lead.id)}`} className="flex items-center gap-2.5 hover:text-primary-600"><Avatar name={lead.name || "Lead"} /><span><span className="block font-semibold text-foreground-900">{lead.name || "Unnamed lead"}</span><span className="mt-1 block text-[10px] text-foreground-500">{lead.next_action_at ? `Follow-up ${new Date(lead.next_action_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "High priority"}</span></span></Link></td><td className="max-w-[220px] px-4 py-4 text-foreground-600">{lead.programme || "—"}</td><td className="px-4 py-4 text-foreground-600">{lead.source || "—"}</td><td className="px-4 py-4"><Badge tone="accent">{lead.stage || "Unknown"}</Badge></td><td className="px-4 py-4"><Badge tone={/high|urgent/i.test(lead.priority) ? "danger" : "neutral"}>{lead.priority || "Unspecified"}</Badge></td><td className="px-4 py-4 text-foreground-600">{lead.owner || "Unassigned"}</td></tr>)}</tbody>
          </table></div>
          {(!visible || !visible.priority.length) && <div className="flex min-h-64 flex-col items-center justify-center gap-2 px-5 py-12 text-center">{loading ? <Spinner size="lg" className="text-primary-500" /> : <i className="ri-user-search-line text-3xl text-primary-300" />}<p className="text-sm font-medium text-foreground-700">{loading ? "Loading priority leads…" : error ? "Priority leads unavailable" : "No priority leads match these filters"}</p><p className="text-xs text-foreground-500">{!loading && !error ? "Try another programme, intake, owner or source." : ""}</p></div>}
        </Card>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-foreground-500"><span>Performance: {period}. Applications in progress and priority leads include all dates.</span><span>{loading ? <LoadingState inline>Updating from backend…</LoadingState> : visible ? `Updated ${new Date(visible.generated_at).toLocaleTimeString("en-GB")} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}` : "Data unavailable"}</span></div>
    </div>
  );
}
