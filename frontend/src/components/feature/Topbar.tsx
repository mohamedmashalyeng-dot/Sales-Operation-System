import { useLocation, useNavigate } from "react-router-dom";
import { useWorkspace } from "@/store/WorkspaceProvider";
import Avatar from "@/components/base/Avatar";
import Menu from "@/components/base/Menu";
import Popover from "@/components/base/Popover";
import Breadcrumbs from "@/components/feature/Breadcrumbs";
import RoleSwitcher from "@/components/feature/RoleSwitcher";
import { IntegrationDot } from "@/components/feature/DemoBanner";
import { buildIntegrationStatuses, integrationSummaryText } from "@/utils/integrations";

interface TopbarProps {
  onOpenSearch: () => void;
  onOpenNotifications: () => void;
}

export default function Topbar({
  onOpenSearch,
  onOpenNotifications,
}: TopbarProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { currentUser, role, state, backendLoadedAt, integrationOverview } = useWorkspace();
  const integrations = buildIntegrationStatuses(state, backendLoadedAt, integrationOverview);
  const integrationSummary = integrationSummaryText(integrations);

  const quickActions = [
    { key: "lead", label: "New lead", icon: "ri-user-add-line", path: "/leads" },
    { key: "task", label: "New task", icon: "ri-checkbox-line", path: "/planner" },
    { key: "application", label: "New application", icon: "ri-file-add-line", path: "/applications" },
  ];

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-background-200 bg-background-50/90 px-4 backdrop-blur md:px-6">
      <div className="hidden min-w-0 md:block">
        <Breadcrumbs pathname={pathname} />
      </div>

      <div className="ml-auto flex items-center gap-1.5 md:gap-2">
        <button
          type="button"
          onClick={onOpenSearch}
          className="hidden h-9 w-64 cursor-pointer items-center gap-2 rounded-md border border-background-300 bg-background-100 px-3 text-left transition-colors hover:border-background-400 xl:flex"
        >
          <span className="flex h-4 w-4 items-center justify-center text-base text-foreground-400">
            <i className="ri-search-line"></i>
          </span>
          <span className="flex-1 text-[13px] text-foreground-400">Search workspace…</span>
          <span className="rounded border border-background-300 bg-background-50 px-1.5 py-0.5 text-[10px] font-semibold text-foreground-500">
            ⌘K
          </span>
        </button>
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-xl text-foreground-600 hover:bg-background-100 xl:hidden"
        >
          <i className="ri-search-line"></i>
        </button>

        <div className="hidden md:block">
          <RoleSwitcher />
        </div>

        <Popover
          panelClassName="w-96 max-w-[calc(100vw-2rem)] p-1"
          trigger={
            <span className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-background-300 bg-background-50 px-2.5 text-[13px] font-semibold text-foreground-700 transition-colors hover:bg-background-100">
              <span className="flex h-4 w-4 items-center justify-center text-base text-foreground-500">
                <i className="ri-plug-line"></i>
              </span>
              <span className="hidden sm:inline">Integrations</span>
              <span className="flex h-4 w-4 items-center justify-center text-base text-foreground-400">
                <i className="ri-arrow-down-s-line"></i>
              </span>
            </span>
          }
        >
          <div className="border-b border-background-200 px-3 py-2.5">
            <p className="font-heading text-[13px] font-bold text-foreground-900">
              Integration status
            </p>
            <p className="mt-0.5 text-[11px] text-foreground-500">
              {integrationSummary}
            </p>
          </div>
          <div className="p-1">
            {integrations.map((integration) => (
              <div
                key={integration.key}
                className="flex items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-background-100"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-base text-foreground-500">
                  <i className={integration.icon}></i>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-foreground-900">
                      {integration.label}
                    </span>
                    <IntegrationDot status={integration.status} />
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">
                    {integration.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Popover>

        <button
          type="button"
          onClick={onOpenNotifications}
          aria-label="Notifications"
          className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-xl text-foreground-600 hover:bg-background-100"
        >
          <i className="ri-notification-3-line"></i>
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-[9px] font-bold text-background-50">
            {state.notifications.filter((n) => !n.read).length}
          </span>
        </button>

        <Menu
          className="hidden sm:block"
          trigger={
            <span className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-primary-500 px-3 text-[13px] font-semibold text-background-50 transition-colors hover:bg-primary-600">
              <span className="flex h-4 w-4 items-center justify-center text-base">
                <i className="ri-add-line"></i>
              </span>
              New
            </span>
          }
          items={quickActions.map((action) => ({
            ...action,
            onSelect: () => navigate(action.path),
          }))}
        />

        <Menu
          header={
            <div className="flex items-center gap-2.5">
              <Avatar name={currentUser.name} size="md" />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-foreground-900">
                  {currentUser.name}
                </p>
                <p className="truncate text-[11px] text-foreground-500">{role.name} role</p>
              </div>
            </div>
          }
          trigger={
            <span className="flex cursor-pointer items-center gap-2 rounded-md p-0.5 hover:bg-background-100">
              <Avatar name={currentUser.name} size="md" />
              <span className="hidden h-4 w-4 items-center justify-center text-base text-foreground-400 xl:flex">
                <i className="ri-arrow-down-s-line"></i>
              </span>
            </span>
          }
          items={[
            {
              key: "profile",
              label: "Your profile",
              icon: "ri-user-line",
              onSelect: () => navigate("/settings"),
            },
            {
              key: "settings",
              label: "Workspace settings",
              icon: "ri-settings-4-line",
              onSelect: () => navigate("/settings"),
            },
            { key: "shortcuts", label: "Keyboard shortcuts", icon: "ri-command-line" },
            {
              key: "switch",
              label: "Switch role",
              icon: "ri-shield-keyhole-line",
              onSelect: () => navigate("/settings"),
            },
            { key: "signout", label: "Sign out", icon: "ri-logout-box-line", tone: "danger" },
          ]}
        />
      </div>
    </header>
  );
}
