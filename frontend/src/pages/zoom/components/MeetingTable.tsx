import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/base/Table";
import type { Meeting } from "@/store/types";
import { formatDateTime } from "@/utils/format";

interface MeetingTableProps {
  meetings: Meeting[];
  onOpen: (meeting: Meeting) => void;
  hostName: (id: string) => string;
  eventName: (id?: string) => string | undefined;
}

export default function MeetingTable({ meetings, onOpen, hostName, eventName }: MeetingTableProps) {
  return (
    <TableWrap>
      <Table className="min-w-[860px]">
        <THead>
          <Th>Meeting</Th>
          <Th>Host</Th>
          <Th>Account</Th>
          <Th>Date &amp; time</Th>
          <Th>Duration</Th>
          <Th>Status</Th>
          <Th className="text-right">Actions</Th>
        </THead>
        <TBody>
          {meetings.map((meeting) => {
            const event = meeting.relatedEventId ? eventName(meeting.relatedEventId) : undefined;
            return (
              <Tr key={meeting.id}>
                <Td>
                  <button
                    type="button"
                    onClick={() => onOpen(meeting)}
                    className="cursor-pointer text-left"
                  >
                    <span className="block text-[13px] font-semibold text-foreground-900 hover:text-primary-600">
                      {meeting.topic}
                    </span>
                    {event ? (
                      <span className="block text-[11px] text-foreground-400">Event: {event}</span>
                    ) : (
                      <span className="block text-[11px] text-foreground-400">{meeting.id}</span>
                    )}
                  </button>
                </Td>
                <Td>{meeting.hostName || (meeting.hostId ? hostName(meeting.hostId) : 'Not recorded')}</Td>
                <Td>
                  <span className="text-[12px] text-foreground-500">{meeting.account}</span>
                </Td>
                <Td>{meeting.startAt ? formatDateTime(meeting.startAt) : 'Not recorded'}</Td>
                <Td>{meeting.durationMins ? `${meeting.durationMins} min` : 'Not recorded'}</Td>
                <Td>
                  <Badge tone={meeting.status === "scheduled" ? "primary" : "neutral"} dot>
                    {meeting.status}
                  </Badge>
                </Td>
                <Td>
                  <div className="flex justify-end">
                    <Button variant="subtle" size="sm" onClick={() => onOpen(meeting)}>
                      Details
                    </Button>
                  </div>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </TableWrap>
  );
}
