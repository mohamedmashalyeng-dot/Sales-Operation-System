import { ROLE_LIST } from "@/config/permissions";
import Badge from "@/components/base/Badge";
import Popover from "@/components/base/Popover";
import { useToast } from "@/components/base/Toast";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { cn } from "@/utils/format";

const TONE_DOT: Record<string, string> = {
  primary: "bg-primary-500",
  accent: "bg-accent-500",
  secondary: "bg-secondary-500",
  danger: "bg-red-500",
  success: "bg-green-500",
  neutral: "bg-foreground-400",
  warning: "bg-amber-500",
};

export default function RoleSwitcher() {
  const { role, setRole, currentUser } = useWorkspace();
  const { toast } = useToast();

  return (
    <Popover
      panelClassName="w-[22rem] p-1"
      trigger={
        <span className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-accent-300 bg-accent-50 px-2.5 text-[13px] font-semibold text-accent-900 transition-colors hover:bg-accent-100">
          <span className="flex h-4 w-4 items-center justify-center text-base text-accent-700">
            <i className="ri-shield-keyhole-line"></i>
          </span>
          <span className="hidden sm:inline">Role</span>
          <span className="text-accent-700">{role.name}</span>
          <span className="flex h-4 w-4 items-center justify-center text-base text-accent-600">
            <i className="ri-arrow-down-s-line"></i>
          </span>
        </span>
      }
    >
      <div className="border-b border-background-200 px-3 py-2.5">
        <p className="font-heading text-[13px] font-bold text-foreground-900">
          Switch workspace role
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">
          Changes navigation, metrics, record visibility and available actions immediately.
        </p>
      </div>
      <div className="p-1">
        {ROLE_LIST.map((option) => {
          const active = option.id === role.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                if (active) return;
                setRole(option.id);
                toast({
                  title: `Now acting as ${option.name}`,
                  message: "Workspace visibility and permissions updated.",
                  tone: "info",
                });
              }}
              className={cn(
                "flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                active ? "bg-accent-50" : "hover:bg-background-100",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base",
                  active ? "bg-accent-200 text-accent-900" : "bg-background-200 text-foreground-600",
                )}
              >
                <i className={option.icon}></i>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-foreground-900">
                    {option.name}
                  </span>
                  <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[option.tone])}></span>
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-foreground-500">
                  {option.description}
                </span>
              </span>
              {active ? (
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-base text-accent-700">
                  <i className="ri-check-line"></i>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="border-t border-background-200 px-3 py-2.5">
        <p className="text-[11px] leading-snug text-foreground-500">
          Acting as <span className="font-semibold text-foreground-700">{currentUser.name}</span>.
        </p>
        <Badge tone="warning" icon="ri-error-warning-line" className="mt-2">
          Simulated permissions — not real security
        </Badge>
      </div>
    </Popover>
  );
}
