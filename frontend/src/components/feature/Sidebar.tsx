import { NavLink } from "react-router-dom";
import { NAV_GROUPS } from "@/config/navigation";
import { roleNavVisible } from "@/config/permissions";
import { useNavBadges } from "@/hooks/useNavBadges";
import { usePreferences } from "@/hooks/useLocalPrefs";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { cn } from "@/utils/format";
import Avatar from "@/components/base/Avatar";
import Logo from "@/components/feature/Logo";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}

export default function Sidebar({ collapsed, onToggle, onNavigate }: SidebarProps) {
  const { currentUser, role } = useWorkspace();
  const badges = useNavBadges();
  const { prefs } = usePreferences();
  const showBadges = prefs.display.showBadges;

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => roleNavVisible(role.id, item.key)),
  })).filter((group) => group.items.length > 0);

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-background-200 bg-background-50 transition-[width] duration-200",
        collapsed ? "w-[76px]" : "w-[264px]",
      )}
    >
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-background-200",
          collapsed ? "justify-center px-3" : "px-4",
        )}
      >
        <Logo collapsed={collapsed} />
      </div>

      <nav className="kbc-scroll flex-1 overflow-y-auto px-3 py-4">
        {groups.map((group) => (
          <div key={group.title} className="mb-4 last:mb-0">
            {!collapsed ? (
              <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-foreground-400">
                {group.title}
              </p>
            ) : (
              <div className="mx-auto mb-2 h-px w-6 bg-background-200" />
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const badge = badges[item.key];
                return (
                  <NavLink
                    key={item.key}
                    to={item.path}
                    end={item.path === "/"}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        "group relative flex items-center gap-3 rounded-md py-2 text-[13px] font-semibold transition-colors",
                        collapsed ? "justify-center px-0" : "px-2.5",
                        isActive
                          ? "bg-primary-50 text-primary-700"
                          : "text-foreground-600 hover:bg-background-100 hover:text-foreground-900",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center text-lg",
                            isActive
                              ? "text-primary-600"
                              : "text-foreground-500 group-hover:text-foreground-700",
                          )}
                        >
                          <i className={item.icon}></i>
                        </span>
                        {!collapsed ? (
                          <>
                            <span className="flex-1 truncate">{item.label}</span>
                            {badge && showBadges ? (
                              <span
                                className={cn(
                                  "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                                  isActive
                                    ? "bg-primary-100 text-primary-700"
                                    : "bg-background-200 text-foreground-600",
                                )}
                              >
                                {badge}
                              </span>
                            ) : null}
                          </>
                        ) : badge && showBadges ? (
                          <span className="absolute right-2.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-[9px] font-bold text-background-50">
                            {badge}
                          </span>
                        ) : null}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-background-200 p-3">
        {!collapsed ? (
          <div className="mb-2 flex items-center gap-2.5 rounded-md bg-background-100 px-2.5 py-2">
            <Avatar name={currentUser.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-foreground-900">
                {currentUser.name}
              </p>
              <p className="truncate text-[11px] text-foreground-500">{role.name}</p>
            </div>
          </div>
        ) : (
          <div className="mb-2 flex justify-center">
            <Avatar name={currentUser.name} size="sm" />
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="flex h-8 w-full cursor-pointer items-center justify-center gap-2 rounded-md text-[12px] font-semibold text-foreground-500 transition-colors hover:bg-background-100 hover:text-foreground-800"
        >
          <span className="flex h-4 w-4 items-center justify-center text-base">
            <i className={collapsed ? "ri-arrow-right-s-line" : "ri-arrow-left-s-line"}></i>
          </span>
          {!collapsed ? "Collapse" : null}
        </button>
      </div>
    </aside>
  );
}