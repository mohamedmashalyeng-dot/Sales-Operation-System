import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import BarList from "@/components/base/BarList";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import MetricCard from "@/components/base/MetricCard";
import SourceFilters, {
  DEFAULT_SOURCE_FILTERS,
  type SourceFilterState,
} from "@/pages/sources/components/SourceFilters";
import SourcePerformanceTable, {
  type SourceSortKey,
} from "@/pages/sources/components/SourcePerformanceTable";
import { useWorkspace } from "@/store/WorkspaceProvider";
import {
  avgTouchesBeforeClosing,
  computeClosingChannel,
  computeFirstVsClosing,
  computeOwnerPerformance,
  computeProgrammeConversion,
  computeSourcePerformance,
} from "@/utils/attribution";

export default function SourcesOverview() {
  const navigate = useNavigate();
  const { state } = useWorkspace();

  const [filters, setFilters] = useState<SourceFilterState>({ ...DEFAULT_SOURCE_FILTERS });
  const [sortKey, setSortKey] = useState<SourceSortKey>("leads");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filteredLeads = useMemo(() => {
    const now = Date.now();
    const q = filters.search.trim().toLowerCase();
    const rangeDays = filters.range === "all" ? null : Number(filters.range);
    return state.leads.filter((lead) => {
      if (filters.programme !== "all" && lead.programme !== filters.programme) return false;
      if (filters.owner !== "all" && lead.ownerId !== filters.owner) return false;
      if (rangeDays != null) {
        if (now - new Date(lead.acquisitionDate).getTime() > rangeDays * 86400000) return false;
      }
      if (q) {
        const haystack = `${lead.source} ${lead.channel} ${lead.campaign ?? ""} ${lead.campaignId ?? ""} ${lead.programme}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [state.leads, filters]);

  const leadIds = useMemo(() => new Set(filteredLeads.map((l) => l.id)), [filteredLeads]);
  const filteredTouchpoints = useMemo(
    () => (Array.isArray(state.touchpoints) ? state.touchpoints : []).filter((t) => leadIds.has(t.leadId)),
    [state.touchpoints, leadIds],
  );

  const sourceRows = useMemo(
    () => computeSourcePerformance(filteredLeads, filteredTouchpoints),
    [filteredLeads, filteredTouchpoints],
  );

  const sortedRows = useMemo(() => {
    const list = [...sourceRows];
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [sourceRows, sortKey, sortDir]);

  const closingChannel = useMemo(() => computeClosingChannel(filteredLeads), [filteredLeads]);
  const firstVsClosing = useMemo(() => computeFirstVsClosing(filteredLeads), [filteredLeads]);
  const programmeConversion = useMemo(() => computeProgrammeConversion(filteredLeads), [filteredLeads]);
  const ownerPerformance = useMemo(
    () =>
      computeOwnerPerformance(filteredLeads, state.users, (ownerId) =>
        state.tasks.filter((t) => t.ownerId === ownerId && t.status === "open").length,
      ),
    [filteredLeads, state.users, state.tasks],
  );

  const won = filteredLeads.filter((l) => l.stage === "Won" || l.closing?.outcome === "won");
  const lost = filteredLeads.filter((l) => l.stage === "Lost" || l.closing?.outcome === "lost");
  const conversionRate = filteredLeads.length ? (won.length / filteredLeads.length) * 100 : 0;
  const avgDaysToClose = (() => {
    const days = won
      .filter((l) => l.closing)
      .map(
        (l) =>
          Math.abs(new Date(l.closing!.closingDate).getTime() - new Date(l.createdAt).getTime()) /
          86400000,
      );
    return days.length ? days.reduce((n, v) => n + v, 0) / days.length : 0;
  })();
  const avgTouches = avgTouchesBeforeClosing(filteredLeads, filteredTouchpoints);

  const eventContribution = useMemo(() => {
    const relevant = filteredTouchpoints.filter(
      (t) =>
        t.interactionType === "Event registration" ||
        t.interactionType === "Event attendance" ||
        t.interactionType === "Webinar attended" ||
        t.interactionType === "Information session attended",
    );
    const map = new Map<string, number>();
    relevant.forEach((t) => map.set(t.source, (map.get(t.source) ?? 0) + 1));
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredTouchpoints]);

  const handleSort = (key: SourceSortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "source" ? "asc" : "desc");
    }
  };

  return (
    <div className="space-y-5">
      <SourceFilters filters={filters} onChange={setFilters} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <MetricCard label="Leads acquired" value={filteredLeads.length} icon="ri-user-add-line" tone="primary" />
        <MetricCard label="Closed Won" value={won.length} icon="ri-trophy-line" tone="success" />
        <MetricCard label="Closed Lost" value={lost.length} icon="ri-close-circle-line" tone="danger" />
        <MetricCard label="Conversion rate" value={`${conversionRate.toFixed(1)}%`} icon="ri-percent-line" tone="accent" />
        <MetricCard
          label="Avg days to close"
          value={avgDaysToClose ? avgDaysToClose.toFixed(0) : "—"}
          icon="ri-timer-line"
          tone="secondary"
        />
        <MetricCard label="Avg touches" value={avgTouches ? avgTouches.toFixed(1) : "—"} icon="ri-route-line" tone="secondary" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            icon="ri-filter-3-line"
            title="Leads acquired by source"
            subtitle="First-touch attribution — click to drill into Leads"
          />
          <CardBody>
            <BarList
              items={sourceRows.map((r) => ({ label: r.source, value: r.leads, hint: r.channel }))}
              tone="primary"
              onSelect={(label) => navigate(`/leads?source=${encodeURIComponent(label)}`)}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            icon="ri-trophy-line"
            iconTone="accent"
            title="Closed Won by closing channel"
            subtitle="Closing-touch attribution"
          />
          <CardBody>
            <BarList items={closingChannel.map((c) => ({ label: c.label, value: c.count }))} tone="accent" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            icon="ri-scales-3-line"
            iconTone="secondary"
            title="First touch vs closing touch"
            subtitle="Acquired leads (solid) compared with won conversions (pale)"
          />
          <CardBody>
            <BarList
              items={firstVsClosing.map((r) => ({
                label: r.source,
                value: r.firstTouch,
                secondary: r.closingTouch,
              }))}
              tone="secondary"
              showSecondary
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            icon="ri-graduation-cap-line"
            title="Programme conversion performance"
            subtitle="Won conversions as a share of leads per programme"
          />
          <CardBody>
            <BarList
              items={programmeConversion.map((p) => ({
                label: p.programme,
                value: p.leads,
                hint: `${p.won} won · ${p.conversionRate.toFixed(0)}% conversion`,
              }))}
              tone="primary"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            icon="ri-calendar-event-line"
            iconTone="accent"
            title="Event &amp; webinar contribution"
            subtitle="Touchpoints from event registrations, attendance and webinars"
          />
          <CardBody>
            <BarList items={eventContribution} tone="accent" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            icon="ri-user-star-line"
            title="Sales owner performance"
            subtitle="Leads owned, conversions and open workload"
          />
          <CardBody className="space-y-2.5">
            {ownerPerformance.length === 0 ? (
              <p className="text-[13px] text-foreground-400">No owner data for this selection.</p>
            ) : (
              ownerPerformance.map((row) => (
                <div
                  key={row.ownerId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-background-200 bg-background-50 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-foreground-900">{row.name}</p>
                    <p className="text-[11px] text-foreground-400">
                      {row.leads} leads · {row.openTasks} open tasks
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <p className="text-[13px] font-bold text-green-700">{row.won}</p>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400">Won</p>
                    </div>
                    <div>
                      <p className="text-[13px] font-bold text-foreground-900">{row.conversionRate.toFixed(0)}%</p>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400">Conv.</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          icon="ri-table-line"
          title="Source performance"
          subtitle="Every figure reconciles with the actual lead records — click a row to open filtered Leads"
        />
        {sortedRows.length === 0 ? (
          <EmptyState
            icon="ri-filter-3-line"
            title="No sources match your filters"
            message="Widen the date range, programme or owner filters."
          />
        ) : (
          <SourcePerformanceTable
            rows={sortedRows}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            onDrill={(source) => navigate(`/leads?source=${encodeURIComponent(source)}`)}
          />
        )}
      </Card>
    </div>
  );
}