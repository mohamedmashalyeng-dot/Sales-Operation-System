import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "@/components/base/Avatar";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import PaginationFooter from "@/components/base/PaginationFooter";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/base/Table";
import {
  ATTENDANCE_OUTCOMES,
  ATTENDANCE_TONES,
  EVENT_AUDIENCE_FILTERS,
  REGISTRATION_STATUS_TONES,
  type AttendanceOutcome,
  type EventAudienceFilter,
} from "@/config/marketing";
import type { EventAudienceRow } from "@/utils/events";
import { invitationTone } from "@/utils/events";
import { formatDateTime } from "@/utils/format";

interface EventAudienceTableProps {
  rows: EventAudienceRow[];
  filter: EventAudienceFilter;
  onFilterChange: (filter: EventAudienceFilter) => void;
  canManage: boolean;
  onAttendance: (registrationId: string, attendance: AttendanceOutcome) => void;
  onCancelRegistration: (registrationId: string) => void;
  onBulkAttendance: (registrationIds: string[], attendance: AttendanceOutcome) => void;
}

const ATTENDANCE_ICONS: Record<AttendanceOutcome, string> = {
  "Attendance Unknown": "ri-question-line",
  Attended: "ri-user-star-line",
  "Did Not Attend": "ri-user-minus-line",
};

const PER_PAGE = 50;

export default function EventAudienceTable({
  rows,
  filter,
  onFilterChange,
  canManage,
  onAttendance,
  onCancelRegistration,
  onBulkAttendance,
}: EventAudienceTableProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pagedRows = rows.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  const selectableKeys = useMemo(
    () => rows.filter((r) => r.registrationId && r.attendance !== "Waiting").map((r) => r.registrationId as string),
    [rows],
  );
  const visibleSelectableKeys = useMemo(
    () => pagedRows.filter((r) => r.registrationId && r.attendance !== "Waiting").map((r) => r.registrationId as string),
    [pagedRows],
  );

  const allSelected =
    visibleSelectableKeys.length > 0 && visibleSelectableKeys.every((k) => selected.includes(k));

  useEffect(() => {
    setSelected((prev) => prev.filter((k) => selectableKeys.includes(k)));
  }, [selectableKeys]);

  const toggleAll = () => {
    setSelected((prev) => {
      if (allSelected) return prev.filter((k) => !visibleSelectableKeys.includes(k));
      return Array.from(new Set([...prev, ...visibleSelectableKeys]));
    });
  };

  const toggleOne = (registrationId: string) => {
    setSelected((prev) =>
      prev.includes(registrationId) ? prev.filter((k) => k !== registrationId) : [...prev, registrationId],
    );
  };

  const runBulk = (attendance: AttendanceOutcome) => {
    if (selected.length === 0) return;
    onBulkAttendance(selected, attendance);
    setSelected([]);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-background-200 px-4 py-3 md:px-5">
        {EVENT_AUDIENCE_FILTERS.map((item) => {
          const active = item.id === filter;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setPage(1);
                onFilterChange(item.id);
              }}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${
                active
                  ? "border-primary-300 bg-primary-100 text-primary-700"
                  : "border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100"
              }`}
            >
              <i className={item.icon}></i>
              {item.label}
            </button>
          );
        })}
      </div>

      {canManage && selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-background-200 bg-secondary-50 px-4 py-2.5 md:px-5">
          <span className="text-[12px] font-semibold text-secondary-900">
            {selected.length} selected
          </span>
          {ATTENDANCE_OUTCOMES.map((outcome) => (
            <Button
              key={outcome}
              variant="outline"
              size="sm"
              leftIcon={<i className={ATTENDANCE_ICONS[outcome]}></i>}
              onClick={() => runBulk(outcome)}
            >
              Mark {outcome}
            </Button>
          ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-[13px] text-foreground-500">
          No people match this filter.
        </div>
      ) : (
        <>
          <PaginationFooter
            position="top"
            currentPage={currentPage}
            pageCount={pageCount}
            total={rows.length}
            itemLabel="people"
            onPageChange={setPage}
          />
          <TableWrap>
            <Table className="min-w-[1100px]">
              <THead>
                {canManage ? (
                  <Th className="w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      disabled={!visibleSelectableKeys.length}
                      onChange={toggleAll}
                      aria-label="Select all registrations"
                      className="h-3.5 w-3.5 cursor-pointer accent-primary-500"
                    />
                  </Th>
                ) : null}
                <Th>Person</Th>
                <Th>Original source</Th>
                <Th>Related campaign</Th>
                <Th>Invitation</Th>
                <Th>Registration</Th>
                <Th>Attendance</Th>
                <Th>Sales owner</Th>
                <Th>Follow-up</Th>
                <Th>Journey</Th>
                {canManage ? <Th className="text-right">Actions</Th> : null}
              </THead>
              <TBody>
                {pagedRows.map((row) => (
                  <Tr key={row.key}>
                    {canManage ? (
                      <Td>
                        {row.registrationId ? (
                          <input
                            type="checkbox"
                            checked={selected.includes(row.registrationId)}
                            disabled={row.attendance === "Waiting"}
                            onChange={() => toggleOne(row.registrationId as string)}
                            aria-label={`Select ${row.name}`}
                            className="h-3.5 w-3.5 cursor-pointer accent-primary-500"
                          />
                        ) : null}
                      </Td>
                    ) : null}
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={row.name} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-foreground-900">{row.name}</p>
                          <p className="truncate text-[11px] text-foreground-400">{row.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-foreground-700">{row.acquisitionSource}</span>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-foreground-600">
                        {row.campaignName ?? "Not recorded"}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={invitationTone(row.invitationStatus)}>{row.invitationStatus}</Badge>
                    </Td>
                    <Td>
                      <div className="flex flex-col gap-0.5">
                        {row.registrationStatus === "Not Registered" ? (
                          <Badge tone="neutral">Not Registered</Badge>
                        ) : (
                          <Badge tone={REGISTRATION_STATUS_TONES[row.registrationStatus]}>
                            {row.registrationStatus}
                          </Badge>
                        )}
                        {row.registeredAt ? (
                          <span className="text-[10px] text-foreground-400">
                            {formatDateTime(row.registeredAt)}
                          </span>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={ATTENDANCE_TONES[row.attendance]}>{row.attendance}</Badge>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-foreground-600">
                        {row.salesOwnerId ? row.salesOwnerId : "Unassigned"}
                      </span>
                    </Td>
                    <Td>
                      {row.followUpRequired ? (
                        <Badge tone="warning" icon="ri-alarm-warning-line">
                          Required
                        </Badge>
                      ) : (
                        <span className="text-[12px] text-foreground-400">--</span>
                      )}
                    </Td>
                    <Td>
                      {row.leadId ? (
                        <Link
                          to={`/leads/${row.leadId}`}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-700"
                        >
                          <i className="ri-route-line"></i> Open
                        </Link>
                      ) : (
                        <span className="text-[11px] text-foreground-400">Not linked</span>
                      )}
                    </Td>
                    {canManage ? (
                      <Td>
                        {row.registrationId ? (
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="icon-sm"
                              aria-label="Mark attended"
                              title="Mark attended"
                              disabled={row.attendance === "Waiting" || row.attendance === "Attended"}
                              onClick={() => onAttendance(row.registrationId as string, "Attended")}
                            >
                              <i className="ri-user-star-line"></i>
                            </Button>
                            <Button
                              variant="outline"
                              size="icon-sm"
                              aria-label="Mark did not attend"
                              title="Mark did not attend"
                              disabled={row.attendance === "Waiting" || row.attendance === "Did Not Attend"}
                              onClick={() => onAttendance(row.registrationId as string, "Did Not Attend")}
                            >
                              <i className="ri-user-minus-line"></i>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Cancel registration"
                              title="Cancel registration"
                              disabled={row.registrationStatus === "Cancelled Registration"}
                              onClick={() => onCancelRegistration(row.registrationId as string)}
                            >
                              <i className="ri-close-circle-line"></i>
                            </Button>
                          </div>
                        ) : (
                          <span className="block text-right text-[11px] text-foreground-400">
                            Invited only
                          </span>
                        )}
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <PaginationFooter
            currentPage={currentPage}
            pageCount={pageCount}
            total={rows.length}
            itemLabel="people"
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
