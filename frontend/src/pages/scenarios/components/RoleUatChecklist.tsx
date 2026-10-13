import Badge from "@/components/base/Badge";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import { Link } from "react-router-dom";
import type { RoleId } from "@/config/permissions";
import { ROLE_UAT } from "@/config/roleUat";
import { cn } from "@/utils/format";

/**
 * Guided, role-based UAT checklist. It presents, for each demo role, the actions
 * that should be PERMITTED and those that should be RESTRICTED, with a link to
 * the relevant module so a reviewer can verify in-app. The acting role is
 * highlighted.
 *
 * Frontend role simulation is NOT secure authentication — that is stated plainly.
 */
export default function RoleUatChecklist({ currentRoleId }: { currentRoleId: RoleId }) {
  return (
    <Card>
      <CardHeader
        icon="ri-shield-keyhole-line"
        iconTone="secondary"
        title="Role-based UAT checklist"
        subtitle="What each demo role may and may not do — verify by switching roles and opening each route"
      />
      <CardBody className="space-y-4">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="flex items-start gap-2 text-[12px] leading-snug text-amber-800">
            <i className="ri-information-line mt-0.5 text-base"></i>
            <span>
              Permissions here are a <strong>frontend-only simulation</strong> for demonstration. They are
              not production authentication or authorisation and can be bypassed in a browser.
            </span>
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {ROLE_UAT.map((group) => {
            const active = group.roleId === currentRoleId;
            return (
              <div
                key={group.roleId}
                className={cn(
                  "rounded-lg border bg-background-50 p-4",
                  active ? "border-primary-400 ring-2 ring-primary-100" : "border-background-200",
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary-100 text-lg text-secondary-900">
                    <i className={group.icon}></i>
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-bold text-foreground-900">{group.roleName}</p>
                      {active ? <Badge tone="primary">Acting role</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-[12px] text-foreground-500">{group.summary}</p>
                  </div>
                </div>

                <ul className="mt-3 space-y-1.5">
                  {group.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start gap-2.5 rounded-md border border-background-200 bg-background-50 px-3 py-2"
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-4 w-4 items-center justify-center text-base",
                          item.expect === "permitted" ? "text-green-600" : "text-red-600",
                        )}
                      >
                        <i className={item.expect === "permitted" ? "ri-check-line" : "ri-close-line"}></i>
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[12.5px] font-semibold text-foreground-800">{item.label}</p>
                          <Badge tone={item.expect === "permitted" ? "success" : "danger"}>
                            {item.expect === "permitted" ? "Permitted" : "Restricted"}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">{item.detail}</p>
                      </div>
                      {item.route ? (
                        <Link
                          to={item.route}
                          className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-background-300 px-2.5 text-[11px] font-semibold text-foreground-600 hover:bg-background-100"
                        >
                          Open
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}