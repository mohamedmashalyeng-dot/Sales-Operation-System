import Avatar from "@/components/base/Avatar";
import Badge from "@/components/base/Badge";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import { useToast } from "@/components/base/Toast";
import { ROLE_LIST } from "@/config/permissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { cn } from "@/utils/format";

export default function SettingsProfile() {
  const { currentUser, role, setRole } = useWorkspace();
  const { toast } = useToast();

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <Card className="xl:col-span-1">
        <CardHeader icon="ri-user-line" title="Your workspace profile" subtitle="Acting user in this session" />
        <CardBody>
          <div className="flex items-center gap-3">
            <Avatar name={currentUser.name} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-heading text-[15px] font-bold text-foreground-900">
                {currentUser.name}
              </p>
              <p className="truncate text-[12px] text-foreground-500">{currentUser.email}</p>
            </div>
          </div>
          <dl className="mt-4 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">
                Role
              </dt>
              <dd>
                <Badge tone={role.tone}>{role.name}</Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">
                Team
              </dt>
              <dd className="text-[13px] font-medium text-foreground-700">{currentUser.team}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">
                Data scope
              </dt>
              <dd className="text-[13px] font-medium text-foreground-700">
                {role.scope === "all" ? "Team-wide records" : "Own records only"}
              </dd>
            </div>
          </dl>
          <p className="mt-4 rounded-md bg-background-100 px-3 py-2 text-[11px] leading-snug text-foreground-500">
            This local profile controls browser-side visibility before backend account data is loaded.
          </p>
        </CardBody>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader
          icon="ri-shield-keyhole-line"
          iconTone="accent"
          title="Role switcher"
          subtitle="Switching changes navigation, metrics, visibility, actions and reports immediately"
        />
        <CardBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {ROLE_LIST.map((option) => {
              const active = option.id === role.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    if (active) return;
                    setRole(option.id);
                    toast({ title: `Now acting as ${option.name}`, tone: "info" });
                  }}
                  className={cn(
                    "flex flex-col rounded-lg border p-3.5 text-left transition-colors",
                    active
                      ? "border-accent-400 bg-accent-50 ring-2 ring-accent-100"
                      : "border-background-200 hover:border-primary-300 hover:bg-primary-50/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-md text-base",
                        active ? "bg-accent-200 text-accent-900" : "bg-background-200 text-foreground-600",
                      )}
                    >
                      <i className={option.icon}></i>
                    </span>
                    {active ? (
                      <Badge tone="accent" icon="ri-check-line">
                        Active
                      </Badge>
                    ) : (
                      <span className="text-[11px] font-semibold text-primary-600">Switch</span>
                    )}
                  </div>
                  <p className="mt-2.5 font-heading text-[14px] font-bold text-foreground-900">
                    {option.name}
                  </p>
                  <p className="mt-1 text-[12px] leading-snug text-foreground-500">
                    {option.description}
                  </p>
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-base text-amber-600">
              <i className="ri-error-warning-line"></i>
            </span>
            <p className="text-[12px] leading-snug text-amber-800">
              Permissions are simulated in the frontend only. They preview role behaviour and are
              not real security.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
