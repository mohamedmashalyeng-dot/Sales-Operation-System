import Avatar from "@/components/base/Avatar";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/base/Table";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { Application } from "@/store/types";
import { APP_STATUS_TONES } from "@/utils/crm";
import { formatDate } from "@/utils/format";

interface ApplicationTableProps {
  applications: Application[];
  onOpen: (id: string) => void;
  onEdit?: (application: Application) => void;
}

export default function ApplicationTable({ applications, onOpen, onEdit }: ApplicationTableProps) {
  const { userName } = useWorkspace();
  const { can } = usePermissions();
  const canEdit = can("applications.edit");

  return (
    <TableWrap>
      <Table>
        <THead>
          <Th>Applicant</Th>
          <Th>Programme</Th>
          <Th>Status</Th>
          <Th>Enrolment source</Th>
          <Th>Owner</Th>
          <Th>Documents</Th>
          <Th>Submitted</Th>
          <Th className="text-right">Actions</Th>
        </THead>
        <TBody>
          {applications.map((app) => {
            const received = app.documents.filter((d) => d.status === "Received").length;
            const verified = app.documents.filter((d) => d.status === "Verified").length;
            return (
              <Tr key={app.id}>
                <Td>
                  <button
                    type="button"
                    onClick={() => onOpen(app.id)}
                    className="flex cursor-pointer items-center gap-2.5 text-left"
                  >
                    <Avatar name={app.applicantName} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-foreground-900 hover:text-primary-600">
                        {app.applicantName}
                      </span>
                      <span className="block truncate text-[11px] text-foreground-400">
                        {app.id} · {app.email}
                      </span>
                    </span>
                  </button>
                </Td>
                <Td>
                  <span className="block text-[13px] font-medium text-foreground-800">
                    {app.programme}
                  </span>
                  <span className="block text-[11px] text-foreground-400">{app.intake}</span>
                </Td>
                <Td>
                  <Badge tone={APP_STATUS_TONES[app.status]}>{app.status}</Badge>
                </Td>
                <Td>{app.enrolmentSource || 'Not recorded'}</Td>
                <Td>{userName(app.ownerId)}</Td>
                <Td>
                  <span className="text-[12px] text-foreground-600">
                    {app.documents.length === 0 ? "—" : `${received + verified}/${app.documents.length} received`}
                  </span>
                </Td>
                <Td>{formatDate(app.submittedAt)}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-1.5">
                    {canEdit && onEdit ? (
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label="Edit application"
                        title="Edit application"
                        onClick={() => onEdit(app)}
                      >
                        <i className="ri-edit-line"></i>
                      </Button>
                    ) : null}
                    <Button variant="subtle" size="sm" onClick={() => onOpen(app.id)}>
                      Open
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
