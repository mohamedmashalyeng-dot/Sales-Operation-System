import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Table, TBody, Td, Th, THead, Tr, TableWrap } from "@/components/base/Table";
import PermissionGate from "@/components/feature/PermissionGate";
import { READINESS_TONES } from "@/config/eligibility";
import type { ReadinessLevel } from "@/config/eligibility";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { IntakeRow } from "@/pages/future-intake/types";
import { formatDate, relativeTime } from "@/utils/format";

interface IntakeTableProps {
  rows: IntakeRow[];
  onEdit: (row: IntakeRow) => void;
  onContact: (row: IntakeRow) => void;
  onReturn: (row: IntakeRow) => void;
}

export default function IntakeTable({ rows, onEdit, onContact, onReturn }: IntakeTableProps) {
  const { userName } = useWorkspace();
  const now = Date.now();

  return (
    <TableWrap>
      <Table className="min-w-[920px]">
        <THead>
          <Th>Learner / Lead</Th>
          <Th>Programme</Th>
          <Th>Preferred intake</Th>
          <Th>Reason</Th>
          <Th>Readiness</Th>
          <Th>Owners</Th>
          <Th>Last contact</Th>
          <Th>Follow-up</Th>
          <Th className="text-right">Actions</Th>
        </THead>
        <TBody>
          {rows.map(({ record, lead }) => {
            const overdue = new Date(record.nextFollowUpAt).getTime() < now;
            return (
              <Tr key={record.id}>
                <Td>
                  <span className="font-semibold text-foreground-900">{lead?.name ?? record.leadId}</span>
                  <span className="block text-[11px] text-foreground-400">{record.leadId}</span>
                </Td>
                <Td>{record.currentProgramme}</Td>
                <Td>
                  <Badge tone="accent">{record.preferredIntake}</Badge>
                </Td>
                <Td>{record.reason}</Td>
                <Td>
                  <Badge tone={READINESS_TONES[record.learnerReadiness as ReadinessLevel] ?? "neutral"}>
                    {record.learnerReadiness}
                  </Badge>
                </Td>
                <Td>
                  <span className="block text-[12px]">Sales: {userName(record.salesOwnerId)}</span>
                  <span className="block text-[12px]">Enrol: {userName(record.enrolmentOwnerId)}</span>
                </Td>
                <Td>{relativeTime(record.lastContactAt)}</Td>
                <Td>
                  <span className={overdue ? "font-semibold text-red-600" : ""}>
                    {formatDate(record.nextFollowUpAt)}
                    {overdue ? " · overdue" : ""}
                  </span>
                </Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <PermissionGate capability="intake.manage">
                      <Button size="icon-sm" variant="ghost" aria-label="Log contact" onClick={() => onContact({ record, lead })}>
                        <i className="ri-phone-line"></i>
                      </Button>
                    </PermissionGate>
                    <PermissionGate capability="intake.manage">
                      <Button size="icon-sm" variant="ghost" aria-label="Edit deferral" onClick={() => onEdit({ record, lead })}>
                        <i className="ri-pencil-line"></i>
                      </Button>
                    </PermissionGate>
                    <PermissionGate capability="intake.manage">
                      <Button size="icon-sm" variant="ghost" aria-label="Return to active intake" onClick={() => onReturn({ record, lead })}>
                        <i className="ri-arrow-go-forward-line"></i>
                      </Button>
                    </PermissionGate>
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