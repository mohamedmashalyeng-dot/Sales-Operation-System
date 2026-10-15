import LoadingState from "@/components/base/LoadingState";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/components/base/Button";
import { Card, CardHeader } from "@/components/base/Card";
import { loadBackendEventPage } from "@/store/backendSync";
import type { CollegeEvent } from "@/store/types";
import EventFilters from "./EventFilters";
import EventTable from "./EventTable";
import EventPeopleCard from "./EventPeopleCard";

const SOURCES = ["all", "Eventbrite", "Zoom", "Manual"].map(value => ({ value, label: value === "all" ? "All sources" : value }));

export default function EventsList({ people = false }: { people?: boolean }) {
  const navigate = useNavigate();
  const [dateFilter, setDateFilter] = useState("all-time");
  const [source, setSource] = useState("all");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState("");
  const [previous, setPrevious] = useState<string[]>([]);
  const [next, setNext] = useState("");
  const [rows, setRows] = useState<CollegeEvent[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const cutoff = useRef(new Date());
  const reset = () => { setCursor(""); setPrevious([]); setTotal(null); cutoff.current = new Date(); };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: people ? "10" : "50", include_total: "true", source, search: search.trim() });
      if (cursor) params.set("cursor", cursor);
      if (dateFilter === "past") params.set("start_to", cutoff.current.toISOString());
      else if (dateFilter !== "all-time") {
        params.set("start_from", cutoff.current.toISOString());
        params.set("upcoming", "true");
        const days = Number(dateFilter.replace("next-", ""));
        if (days > 0) params.set("start_to", new Date(cutoff.current.getTime() + days * 86400000).toISOString());
      }
      void loadBackendEventPage(params, controller.signal).then(page => {
        if (controller.signal.aborted) return;
        setRows(page.events); setNext(page.nextCursor);
        if (page.total !== null) setTotal(page.total);
      }).catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Events could not be loaded.");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [dateFilter, source, search, cursor, revision, people]);

  return <div className="space-y-4">
    <EventFilters dateFilter={dateFilter} onDateFilter={value => { reset(); setDateFilter(value); }}
      source={source} onSource={value => { reset(); setSource(value); }} sourceOptions={SOURCES}
      search={search} onSearch={value => { reset(); setSearch(value); }} />
    <Card>
      <CardHeader icon="ri-list-check-2" title={people ? "People by event" : "Events list"} subtitle={loading ? "Loading events..." : total === null ? undefined : `${total} events match the current filters`}
        action={<Button variant="outline" size="sm" loading={loading} disabled={loading} onClick={() => { reset(); setRevision(value => value + 1); }}>Refresh events</Button>} />
      {error ? <div role="alert" className="p-5 text-sm text-red-700">Unable to load events: {error}
        <Button className="ml-3" size="sm" variant="outline" onClick={() => setRevision(value => value + 1)}>Retry events</Button></div>
        : loading ? <LoadingState className="p-5 text-sm">Loading events...</LoadingState>
        : people && rows.length ? <div className="space-y-4 p-4">{rows.map((event, index) => <EventPeopleCard key={event.id} event={event} initiallyOpen={index === 0} />)}</div>
        : <EventTable events={rows} emptyMessage="No events match your filters. Import or sync events, or try another filter."
          onOpen={id => navigate(`/events/${encodeURIComponent(id)}`)} />}
      <div className="flex items-center justify-between gap-3 border-t border-background-200 p-4">
        <p className="text-xs text-foreground-500">Page {previous.length + 1}{!loading && !error ? ` · ${rows.length} events shown` : ""}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={loading || !previous.length} onClick={() => { setCursor(previous[previous.length - 1]); setPrevious(value => value.slice(0, -1)); }}>Previous events</Button>
          <Button size="sm" variant="outline" disabled={loading || Boolean(error) || !next} onClick={() => { setPrevious(value => [...value, cursor]); setCursor(next); }}>Next events</Button>
        </div>
      </div>
    </Card>
  </div>;
}
