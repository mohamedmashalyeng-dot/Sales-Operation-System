import Avatar from "@/components/base/Avatar";
import Badge from "@/components/base/Badge";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import { ROLE_LIST, roleCan, type Capability } from "@/config/permissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { cn } from "@/utils/format";

const MATRIX: { group: string; rows: { label: string; cap: Capability }[] }[] = [
  {
    group: "Leads",
    rows: [
      { label: "View leads", cap: "leads.view" },
      { label: "Create / edit leads", cap: "leads.create" },
      { label: "Delete leads", cap: "leads.delete" },
      { label: "Assign owners", cap: "leads.assign" },
    ],
  },
  {
    group: "Inbox",
    rows: [
      { label: "Reply to emails", cap: "inbox.reply" },
      { label: "Assign emails", cap: "inbox.assign" },
      { label: "Bulk actions", cap: "inbox.bulk" },
    ],
  },
  {
    group: "Applications",
    rows: [
      { label: "View applications", cap: "applications.view" },
      { label: "Edit applications", cap: "applications.edit" },
      { label: "Approvals", cap: "applications.approve" },
    ],
  },
  {
    group: "Events & Zoom",
    rows: [
      { label: "Manage events", cap: "events.manage" },
      { label: "Event reports", cap: "events.reports" },
      { label: "Schedule callbacks", cap: "zoom.callback" },
    ],
  },
  {
    group: "Administration",
    rows: [
      { label: "Team reporting", cap: "reports.team" },
      { label: "Admin console", cap: "admin.view" },
      { label: "Manage users", cap: "admin.manageUsers" },
      { label: "Audit trail", cap: "audit.view" },
    ],
  },
];

export default function SettingsUsers() {
  const { state, role } = useWorkspace();

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon="ri-group-line"
          iconTone="secondary"
          title="Workspace users"
          subtitle="Frontend role profiles used by this browser session"
        />
        <CardBody className="space-y-2.5">
          {state.users.map((user) => {
            const mappedRole = ROLE_LIST.find((r) => r.userId === user.id);
            const isActive = mappedRole?.id === role.id;
            return (
              <div
                key={user.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3",
                  isActive ? "border-primary-300 bg-primary-50/50" : "border-background-200 bg-background-50",
                )}
              >
                <Avatar name={user.name} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-foreground-900">
                    {user.name}
                  </p>
                  <p className="truncate text-[12px] text-foreground-500">{user.email}</p>
                </div>
                <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                  <span className="text-[12px] font-medium text-foreground-600">{user.role}</span>
                  {mappedRole ? (
                    <Badge tone={mappedRole.tone}>{mappedRole.name}</Badge>
                  ) : (
                    <Badge tone="neutral">No workspace role</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon="ri-shield-check-line"
          iconTone="accent"
          title="Role permission overview"
          subtitle="Frontend-only capabilities by role"
        />
        <div className="kbc-scroll overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="border-b border-background-200 bg-background-100/60">
              <tr>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-foreground-500">
                  Capability
                </th>
                {ROLE_LIST.map((r) => (
                  <th
                    key={r.id}
                    className="px-4 py-2.5 text-center text-[11px] font-bold uppercase tracking-wide text-foreground-500"
                  >
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-background-200">
              {MATRIX.map((section) => (
                <SectionRows key={section.group} section={section} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SectionRows({ section }: { section: (typeof MATRIX)[number] }) {
  return (
    <>
      <tr className="bg-background-100/60">
        <td
          colSpan={5}
          className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground-400"
        >
          {section.group}
        </td>
      </tr>
      {section.rows.map((row) => (
        <tr key={row.cap} className="hover:bg-background-100/60">
          <td className="px-4 py-2.5 text-[13px] text-foreground-700">{row.label}</td>
          {ROLE_LIST.map((r) => {
            const allowed = roleCan(r.id, row.cap);
            return (
              <td key={r.id} className="px-4 py-2.5 text-center">
                {allowed ? (
                  <span className="inline-flex h-5 w-5 items-center justify-center text-base text-green-600">
                    <i className="ri-check-line"></i>
                  </span>
                ) : (
                  <span className="inline-flex h-5 w-5 items-center justify-center text-base text-foreground-300">
                    <i className="ri-subtract-line"></i>
                  </span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
