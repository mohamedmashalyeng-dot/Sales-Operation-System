import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/base/Table";
import type { Call } from "@/store/types";
import { CALL_STATUS_TONES, formatDuration } from "@/utils/crm";
import { relativeTime } from "@/utils/format";

interface CallTableProps {
  calls: Call[];
  onOpen: (call: Call) => void;
  onCallback: (call: Call) => void;
  leadLabel: (leadId?: string) => { name: string; known: boolean } | undefined;
}

export default function CallTable({ calls, onOpen, onCallback, leadLabel }: CallTableProps) {
  return (
    <TableWrap>
      <Table className="min-w-[860px]">
        <THead>
          <Th>Direction</Th>
          <Th>Contact</Th>
          <Th>Number</Th>
          <Th>Status</Th>
          <Th>Duration</Th>
          <Th>Linked lead</Th>
          <Th>When</Th>
          <Th className="text-right">Actions</Th>
        </THead>
        <TBody>
          {calls.map((call) => {
            const label = leadLabel(call.leadId);
            return (
              <Tr key={call.id}>
                <Td>
                  <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground-700">
                    <i
                      className={
                        call.direction === "incoming"
                          ? "ri-arrow-left-down-line text-green-600"
                          : "ri-arrow-right-up-line text-primary-600"
                      }
                    ></i>
                    {call.direction}
                  </span>
                </Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => onOpen(call)}
                    className="cursor-pointer text-left"
                  >
                    <span className="block text-[13px] font-semibold text-foreground-900 hover:text-primary-600">
                      {call.direction === "incoming" ? call.caller : call.receiver}
                    </span>
                    <span className="block text-[11px] text-foreground-400">
                      {call.direction === "incoming" ? `to ${call.receiver}` : `from ${call.caller}`}
                    </span>
                  </button>
                </Td>
                <Td>
                  <span className="text-[12px] text-foreground-600">{call.phoneNumber}</span>
                </Td>
                <Td>
                  <Badge tone={CALL_STATUS_TONES[call.status]}>{call.status}</Badge>
                </Td>
                <Td>{formatDuration(call.durationSec)}</Td>
                <Td>
                  {label ? (
                    label.known ? (
                      <Badge tone="success" icon="ri-link">
                        {label.name}
                      </Badge>
                    ) : (
                      <Badge tone="warning">Uncertain match</Badge>
                    )
                  ) : (
                    <span className="text-[12px] text-foreground-400">No match</span>
                  )}
                </Td>
                <Td>{relativeTime(call.occurredAt)}</Td>
                <Td>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => onOpen(call)}>
                      Detail
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<i className="ri-phone-line"></i>}
                      onClick={() => onCallback(call)}
                    >
                      Call back
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