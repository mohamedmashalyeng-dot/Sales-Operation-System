import { useState } from "react";
import Avatar from "@/components/base/Avatar";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import PaginationFooter from "@/components/base/PaginationFooter";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/base/Table";
import type { EventRegistration, RegOutcome } from "@/store/types";
import { OUTCOME_TONES } from "@/utils/crm";
import { formatDateTime } from "@/utils/format";

interface RegistrationTableProps {
  registrations: EventRegistration[];
  canManage: boolean;
  onOutcome: (registrationId: string, outcome: RegOutcome) => void;
  onCallback: (registration: EventRegistration) => void;
  showProgramme?: boolean;
  allowAttendance?: boolean;
}

const PER_PAGE = 50;

export default function RegistrationTable({
  registrations,
  canManage,
  onOutcome,
  onCallback,
  showProgramme = true,
  allowAttendance = false,
}: RegistrationTableProps) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(registrations.length / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pagedRegistrations = registrations.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  return (
    <>
    <PaginationFooter
      position="top"
      currentPage={currentPage}
      pageCount={pageCount}
      total={registrations.length}
      itemLabel="registrations"
      onPageChange={setPage}
    />
    <TableWrap>
      <Table className="min-w-[820px]">
        <THead>
          <Th>Attendee</Th>
          {showProgramme ? <Th>Programme</Th> : null}
          <Th>Outcome</Th>
          <Th>Callback</Th>
          <Th>Notes</Th>
          <Th className="text-right">Actions</Th>
        </THead>
        <TBody>
          {pagedRegistrations.length === 0 ? (
            <Tr>
              <td
                colSpan={showProgramme ? 6 : 5}
                className="px-4 py-8 text-center text-[13px] text-foreground-400"
              >
                No registrations to show
              </td>
            </Tr>
          ) : (
            pagedRegistrations.map((reg) => (
            <Tr key={reg.id}>
              <Td>
                <div className="flex items-center gap-2.5">
                  <Avatar name={reg.name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-foreground-900">{reg.name}</p>
                    <p className="truncate text-[11px] text-foreground-400">{reg.email}</p>
                  </div>
                </div>
              </Td>
              {showProgramme ? <Td>{reg.programme}</Td> : null}
              <Td>
                <Badge tone={OUTCOME_TONES[reg.outcome]}>{reg.outcome}</Badge>
              </Td>
              <Td>
                {reg.callbackAt ? (
                  <span className="text-[12px] text-foreground-600">
                    {formatDateTime(reg.callbackAt)}
                  </span>
                ) : (
                  <span className="text-[12px] text-foreground-400">—</span>
                )}
              </Td>
              <Td>
                <span className="text-[12px] text-foreground-500">{reg.notes || "—"}</span>
              </Td>
              <Td>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {canManage ? (
                    <>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label="Confirm"
                        title="Confirm attendance"
                        disabled={reg.outcome === "confirmed"}
                        onClick={() => onOutcome(reg.id, "confirmed")}
                      >
                        <i className="ri-check-line"></i>
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label="Decline"
                        title="Mark declined"
                        disabled={reg.outcome === "declined"}
                        onClick={() => onOutcome(reg.id, "declined")}
                      >
                        <i className="ri-close-line"></i>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Schedule callback"
                        leftIcon={<i className="ri-phone-line"></i>}
                        onClick={() => onCallback(reg)}
                      >
                        Callback
                      </Button>
                      {allowAttendance ? (
                        <>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label="Mark attended"
                            title="Mark attended"
                            disabled={reg.outcome === "attended"}
                            onClick={() => onOutcome(reg.id, "attended")}
                          >
                            <i className="ri-user-star-line"></i>
                          </Button>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label="Mark no-show"
                            title="Mark no-show"
                            disabled={reg.outcome === "no-show"}
                            onClick={() => onOutcome(reg.id, "no-show")}
                          >
                            <i className="ri-user-unfollow-line"></i>
                          </Button>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-[11px] text-foreground-400">View only</span>
                  )}
                </div>
              </Td>
            </Tr>
            ))
          )}
        </TBody>
      </Table>
    </TableWrap>
    <PaginationFooter
      currentPage={currentPage}
      pageCount={pageCount}
      total={registrations.length}
      itemLabel="registrations"
      onPageChange={setPage}
    />
    </>
  );
}
