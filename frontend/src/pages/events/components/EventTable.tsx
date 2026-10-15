import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/base/Table";
import type { CollegeEvent } from "@/store/types";
import { formatDateTime } from "@/utils/format";
import { eventPhase, recordedAttendance } from "@/utils/eventAttendance";

const SOURCE_TONES = {
  Eventbrite: "accent",
  Zoom: "primary",
  Manual: "secondary",
} as const;

const STATUS_TONES = {
  upcoming: "primary",
  live: "success",
  completed: "neutral",
} as const;

export default function EventTable({
  events,
  onOpen,
  emptyMessage = "No events to show",
}: {
  events: CollegeEvent[];
  onOpen: (id: string) => void;
  emptyMessage?: string;
}) {
  return (
    <TableWrap>
      <Table>
        <THead>
          <Th>Event</Th>
          <Th>Start</Th>
          <Th>Source</Th>
          <Th>Status</Th>
          <Th className="text-center">Booked</Th>
          <Th className="text-center">Confirmed</Th>
          <Th className="text-center">Declined</Th>
          <Th className="text-center">Pending</Th>
          <Th className="text-center">Attendance</Th>
          <Th className="text-right">Actions</Th>
        </THead>
        <TBody>
          {events.length === 0 ? (
            <Tr>
              <td colSpan={10} className="px-4 py-8 text-center text-[13px] text-foreground-400">
                {emptyMessage}
              </td>
            </Tr>
          ) : (
            events.map((event) => {
            const confirmed = event.registrationMetrics ? event.registrationMetrics.confirmed + event.registrationMetrics.attended : event.registrations.filter((r) =>
              ["confirmed", "attended"].includes(r.outcome),
            ).length;
            const declined = event.registrationMetrics?.declined ?? event.registrations.filter((r) => r.outcome === "declined").length;
            const pending = event.registrationMetrics?.pending ?? event.registrations.filter((r) => r.outcome === "pending").length;
            const phase = eventPhase(event);
            const attended = event.registrationMetrics?.attended ?? event.registrations.filter(reg => recordedAttendance(reg) === "Attended").length;
            return (
              <Tr key={event.id}>
                <Td>
                  <button
                    type="button"
                    onClick={() => onOpen(event.id)}
                    className="cursor-pointer text-left"
                  >
                    <span className="block text-[13px] font-semibold text-foreground-900 hover:text-primary-600">
                      {event.name}
                    </span>
                    <span className="block text-[11px] text-foreground-400">{event.location}</span>
                  </button>
                </Td>
                <Td>{formatDateTime(event.startAt)}</Td>
                <Td>
                  <Badge tone={SOURCE_TONES[event.source]}>{event.source}</Badge>
                </Td>
                <Td>
                  <Badge tone={STATUS_TONES[phase]} dot>
                    {phase}
                  </Badge>
                </Td>
                <Td className="text-center font-semibold">{event.registrationMetrics?.booked ?? event.registrations.length}</Td>
                <Td className="text-center font-semibold text-green-700">{confirmed}</Td>
                <Td className="text-center font-semibold text-red-600">{declined}</Td>
                <Td className="text-center font-semibold text-amber-600">{pending}</Td>
                <Td className="text-center"><Badge tone={phase === "completed" ? "success" : "warning"}>{phase === "completed" ? `${attended} attended` : "Waiting"}</Badge></Td>
                <Td>
                  <div className="flex justify-end">
                    <Button variant="subtle" size="sm" onClick={() => onOpen(event.id)}>
                      Open
                    </Button>
                  </div>
                </Td>
              </Tr>
            );
            })
          )}
        </TBody>
      </Table>
    </TableWrap>
  );
}
