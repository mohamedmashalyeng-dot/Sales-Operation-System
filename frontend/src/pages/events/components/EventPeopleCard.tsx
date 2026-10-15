import LoadingState from "@/components/base/LoadingState";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardHeader } from "@/components/base/Card";
import PaginationFooter from "@/components/base/PaginationFooter";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/base/Table";
import { loadBackendEventPeople, type BackendEventPerson } from "@/store/backendSync";
import type { CollegeEvent } from "@/store/types";
import { formatDateTime } from "@/utils/format";
import { eventAttendance } from "@/utils/eventAttendance";

function attendance(event: CollegeEvent, person: BackendEventPerson) {
  const outcome = eventAttendance(event, person);
  if (outcome === "Attended" && person.attended_at) return `Attended · ${formatDateTime(person.attended_at)}`;
  return outcome === "Attendance Unknown" ? "Attendance not recorded" : outcome;
}

export default function EventPeopleCard({ event, initiallyOpen = false }: { event: CollegeEvent; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: BackendEventPerson[]; total: number; has_more: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setLoading(true); setError("");
    void loadBackendEventPeople(event.id, offset, controller.signal).then(page => {
      if (!controller.signal.aborted) setData(page);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "People could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, event.id, offset, revision]);

  return <div data-event-id={event.id}><Card>
    <CardHeader title={event.name} icon="ri-group-line"
      subtitle={`${event.source} · ${formatDateTime(event.startAt)}${data ? ` · ${data.total} people` : ""}`}
      action={<div className="flex gap-2">
        <Link to={`/events/${encodeURIComponent(event.id)}`} className="inline-flex items-center px-2 text-xs font-semibold text-primary-700 hover:underline">Open event</Link>
        <Button size="sm" variant="outline" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} people for ${event.name}`} onClick={() => setOpen(value => !value)}>
          {open ? "Hide people" : "Show people"}
        </Button>
      </div>} />
    {open ? error ? <div role="alert" className="p-4 text-sm text-red-700">Unable to load people: {error}
      <Button size="sm" variant="outline" className="ml-2" onClick={() => setRevision(value => value + 1)}>Retry people</Button></div>
      : loading ? <LoadingState className="p-4 text-sm">Loading people for {event.name}...</LoadingState>
      : data ? <>
        <PaginationFooter position="top" currentPage={offset / 50 + 1} pageCount={Math.max(1, Math.ceil(data.total / 50))}
          total={data.total} itemLabel="people" onPageChange={page => setOffset((page - 1) * 50)} />
        <TableWrap><Table className="min-w-[800px]">
          <THead><Th>Person</Th><Th>Email</Th><Th>Phone</Th><Th>Registration status</Th><Th>Attendance</Th><Th>Lead</Th></THead>
          <TBody>{data.items.length ? data.items.map(person => <Tr key={person.id}>
            <Td><span className="font-semibold">{person.name || person.email || "Unnamed person"}</span></Td>
            <Td>{person.email || "Not recorded"}</Td><Td>{person.phone || "Not recorded"}</Td>
            <Td><Badge tone="neutral">{person.status || "Not recorded"}</Badge></Td>
            <Td><Badge tone={eventAttendance(event, person) === "Waiting" ? "warning" : "neutral"}>{attendance(event, person)}</Badge></Td>
            <Td>{person.lead_id ? <Link className="font-semibold text-primary-700 hover:underline" to={`/leads/${encodeURIComponent(person.lead_id)}`}>Open lead</Link> : "Not linked"}</Td>
          </Tr>) : <Tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-foreground-500">No people are recorded for this event.</td></Tr>}</TBody>
        </Table></TableWrap>
        <PaginationFooter currentPage={offset / 50 + 1} pageCount={Math.max(1, Math.ceil(data.total / 50))}
          total={data.total} itemLabel="people" onPageChange={page => setOffset((page - 1) * 50)} />
      </> : null : null}
  </Card></div>;
}
