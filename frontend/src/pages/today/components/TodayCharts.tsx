import LoadingState, { Spinner } from "@/components/base/LoadingState";
import { Card, CardHeader } from "@/components/base/Card";
import type { TodayOverview } from "../useTodayOverview";
import { todayDates } from "../useTodayOverview";

const colors = ["#6425df", "#9c7cff", "#d8ceff"];
function key(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
export function changeLabel(current: number, previous: number) {
  if (!previous) return current ? `${current.toLocaleString()} vs 0 in previous period` : "No change vs previous period";
  const change = Math.round((current - previous) / previous * 100);
  return `${change > 0 ? "+" : ""}${change}% vs previous period`;
}
export function dailyValues(data: TodayOverview, kind: string, days: number) {
  const now = new Date(data.as_of);
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1 + i), dateKey = key(date);
    const count = (k: string) => data.daily.find(r => r.kind === k && r.date === dateKey)?.count || 0;
    return { label: date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), value: kind === "sla" ? count("sla_total") ? Math.round(count("sla_good") / count("sla_total") * 100) : null : count(kind) };
  });
}
export function SparkBars({ values, tone }: { values: { label: string; value: number | null }[]; tone: string }) {
  const max = Math.max(1, ...values.map(v => v.value || 0));
  return <div className="flex h-8 w-16 items-end gap-0.5" aria-label="Daily values for the last seven days">{values.map((v,i) => <div key={i} title={`${v.label}: ${v.value === null ? "No samples" : v.value}`} className={`min-w-0 flex-1 rounded-t-sm ${tone === "gold" ? "bg-accent-500" : tone === "green" ? "bg-green-400" : "bg-primary-400"}`} style={{ height: `${(v.value || 0) / max * 100}%` }} />)}</div>;
}
export function SalesPerformance({ data, range, programme, loading, onRefresh }: { data: TodayOverview | null; range: string; programme: string; loading: boolean; onRefresh: () => void }) {
  const total = data?.totals.applications?.current || 0, previous = data?.totals.applications?.previous || 0;
  const target = range === "month" ? data?.monthly_target : null;
  const percent = target ? Math.round(total / target * 100) : null;
  const now = new Date(data?.as_of || Date.now()), start = new Date(todayDates(range,6,now).period_start);
  const label = range === "week" ? "This week" : range === "year" ? "This year" : "This month";
  const days: { date: Date; total: number }[] = [];
  let running = 0;
  for (const date = new Date(start); date <= now; date.setDate(date.getDate() + 1)) {
    running += data?.daily.find(row => row.kind === "applications" && row.date === key(date))?.count || 0;
    days.push({ date: new Date(date), total: running });
  }
  const bars = Array.from({ length: Math.min(6, days.length) }, (_, i) => days[Math.ceil((i + 1) * days.length / Math.min(6, days.length)) - 1]);
  const max = Math.max(target || 0, total, 1);
  return <Card><CardHeader title="Sales Performance Overview" subtitle={`${label} · applications ${programme === "all" ? "(all programmes)" : `for ${programme}`}`} icon="ri-line-chart-line" action={<button aria-label="Refresh Today" title="Refresh Today" disabled={loading} onClick={onRefresh} className="rounded-md px-2 py-1 text-foreground-500 hover:bg-primary-50 disabled:opacity-40">{loading ? <Spinner size="sm" /> : <i className="ri-refresh-line" />}</button>} />
    <div className="flex flex-col gap-6 p-5 md:flex-row md:items-center">
      <div className="grid shrink-0 grid-cols-[112px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 sm:flex sm:flex-wrap sm:justify-center sm:gap-8">
        <div className="relative h-28 w-28 sm:h-36 sm:w-36"><svg viewBox="0 0 140 140" className="h-full w-full -rotate-90" aria-label={percent === null ? "Target not set" : `${percent}% of target`}><circle cx="70" cy="70" r="60" fill="none" stroke="currentColor" className="text-background-200" strokeWidth="14" /><circle cx="70" cy="70" r="60" fill="none" stroke="#7934fa" strokeWidth="14" strokeDasharray={`${Math.min(percent || 0,100) / 100 * 377} 377`} /></svg><div className="absolute inset-0 flex flex-col items-center justify-center"><strong className="font-heading text-2xl text-foreground-950">{data && percent !== null ? `${percent}%` : "—"}</strong><span className="mt-1 text-[11px] text-foreground-500">{target ? "of target" : "Target not set"}</span></div></div>
        <div className="text-center"><p className="font-heading text-[32px] font-bold leading-10 text-foreground-950" data-today-applications>{data ? total.toLocaleString() : "—"}</p><p className="text-xs text-foreground-600">Applications</p><p className="mt-2 max-w-[165px] text-[11px] text-foreground-500">{data ? changeLabel(total,previous) : loading ? <LoadingState inline>Loading…</LoadingState> : "Unavailable"}</p></div>
        <div className="text-center"><p className="font-heading text-[32px] font-bold leading-10 text-foreground-950">{target?.toLocaleString() || "—"}</p><p className="text-xs text-foreground-600"><i className="ri-focus-3-line mr-1 text-primary-400" />Monthly target</p></div>
      </div>
      <div className="relative min-w-0 flex-1 border-background-200 md:border-l md:pl-6">
        <div className="relative h-40 border-b border-background-200">
          {target && <div className="absolute left-0 right-0 border-t border-dashed border-primary-300" style={{ bottom: `${target/max * 95}%` }}><span className="absolute -top-2 right-0 rounded-full bg-background-100 px-2 text-[10px] text-primary-700">Target {target.toLocaleString()}</span></div>}
          <div className="flex h-full items-end gap-1">{bars.map((bar,i) => <div key={i} className="group relative flex h-full min-w-0 flex-1 items-end"><div tabIndex={0} aria-label={`${bar.date.toLocaleDateString("en-GB")}: ${bar.total} cumulative applications`} className="w-full rounded-t-sm bg-primary-400 outline-primary-600" style={{ height: `${bar.total/max * 95}%` }} /><span className="pointer-events-none absolute bottom-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground-900 px-2 py-1 text-[10px] text-white group-hover:block group-focus-within:block">{bar.total.toLocaleString()} applications</span></div>)}</div>
          {!data && <span className="absolute inset-0 flex items-center justify-center text-xs text-foreground-500">{loading ? <LoadingState inline>Loading performance…</LoadingState> : "Performance unavailable"}</span>}
        </div>
        <div className="mt-2 flex gap-1 text-center text-[10px] text-foreground-500">{bars.map((bar,i) => <span key={i} className="min-w-0 flex-1">{bar.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>)}</div>
        <p className="mt-2 text-right text-[10px] text-foreground-500">Cumulative applications · {data && !total ? "No applications in this period" : "through today"}</p>
      </div>
    </div>
  </Card>;
}
export function PipelineChart({ data, months, loading }: { data: TodayOverview | null; months: number; loading: boolean }) {
  const now = new Date(data?.as_of || Date.now());
  const series = ["leads","applications","enrolled"], labels = ["New Leads","Applications","Enrolled"];
  const rows = Array.from({ length: months }, (_, i) => {
    const date = new Date(now.getFullYear(),now.getMonth() - months + 1 + i,1), prefix = key(date).slice(0,7);
    return { label:date.toLocaleDateString("en-GB", { month:"short",year:months>6 ? "2-digit":undefined }), values:series.map(kind => data?.daily.filter(row => row.kind===kind && row.date.startsWith(prefix)).reduce((sum,r) => sum+r.count,0) || 0) };
  });
  const rawMax = Math.max(1,...rows.flatMap(row => row.values)), step = Math.max(1, Math.ceil(rawMax / 4)), max = step * 4;
  const width=560, height=280, left=46, right=12, top=20, bottom=36, plotHeight=height-top-bottom, groupWidth=(width-left-right)/months, barWidth=Math.min(12,groupWidth/5);
  return <div className="p-5"><div className="mb-3 flex flex-wrap gap-4 text-[11px] text-foreground-600">{labels.map((label,i) => <span key={label} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background:colors[i] }} />{label}</span>)}</div>
    {data ? <figure><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly leads, applications and enrolled learners" className="w-full">
      {[0,1,2,3,4].map(i => { const y=top+plotHeight - i*plotHeight/4; return <g key={i}><line x1={left} x2={width-right} y1={y} y2={y} className="stroke-background-200" /><text x={left-10} y={y+4} textAnchor="end" fontSize="10" className="fill-foreground-500">{new Intl.NumberFormat("en",{notation:"compact"}).format(step*i)}</text></g>; })}
      {rows.map((row,i) => { const x=left + groupWidth*(i+0.5); return <g key={i}><text x={x} y={height-10} textAnchor="middle" fontSize="10" className="fill-foreground-500">{row.label}</text>{row.values.map((value,j) => <rect key={j} x={x+(j-1.5)*(barWidth+3)} y={top+plotHeight-value/max*plotHeight} width={barWidth} height={value/max*plotHeight} rx="2" fill={colors[j]} tabIndex={0} aria-label={`${row.label}: ${value} ${labels[j]}`}><title>{row.label}: {value.toLocaleString()} {labels[j]}</title></rect>)}</g>; })}
    </svg><figcaption className="mt-1 text-[10px] text-foreground-500">Current month to date. Enrolled uses recorded enrolment dates or won stage changes.{data.totals.enrolled?.undated ? ` ${data.totals.enrolled.undated.toLocaleString()} undated outcomes excluded.` : ""}{!rows.some(row => row.values.some(Boolean)) ? " No activity in this period." : ""}</figcaption></figure> : <div className="flex h-64 items-center justify-center text-xs text-foreground-500">{loading ? <LoadingState inline>Loading pipeline…</LoadingState> : "Pipeline unavailable"}</div>}
  </div>;
}
