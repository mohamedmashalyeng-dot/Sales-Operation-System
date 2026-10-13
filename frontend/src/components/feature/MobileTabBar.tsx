import { useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { NAV_GROUPS, type NavItem } from "@/config/navigation";
import { roleNavVisible } from "@/config/permissions";
import { useNavBadges } from "@/hooks/useNavBadges";
import { usePreferences } from "@/hooks/useLocalPrefs";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { cn } from "@/utils/format";

const PRIMARY_KEYS = ["today", "leads", "inbox", "planner"] as const;

function isActive(pathname: string, item: NavItem): boolean {
  if (item.path === "/") return pathname === "/";
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

function badgeText(value: number): string {
  return value > 99 ? "99+" : String(value);
}

export default function MobileTabBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { role } = useWorkspace();
  const badges = useNavBadges();
  const { prefs } = usePreferences();
  const [moreOpen, setMoreOpen] = useState(false);
  const showBadges = prefs.display.showBadges;

  const visibleItems = useMemo(
    () => NAV_GROUPS.flatMap((group) => group.items).filter((item) => roleNavVisible(role.id, item.key)),
    [role.id],
  );

  const primaryItems = PRIMARY_KEYS.map((key) => visibleItems.find((item) => item.key === key)).filter(
    (item): item is NavItem => Boolean(item),
  );
  const moreItems = visibleItems.filter((item) => !PRIMARY_KEYS.includes(item.key as (typeof PRIMARY_KEYS)[number]));
  const moreActive = moreItems.some((item) => isActive(pathname, item));
  const tabs = moreItems.length
    ? [
        ...primaryItems,
        {
          key: "more",
          label: "More",
          path: "#more",
          icon: "ri-more-2-fill",
        },
      ]
    : primaryItems;

  const openPath = (path: string) => {
    setMoreOpen(false);
    navigate(path);
  };

  return (
    <>
      {moreOpen ? (
        <div className="fixed inset-0 z-[55] bg-foreground-950/30 lg:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute inset-x-3 bottom-[5.75rem] max-h-[60vh] overflow-hidden rounded-lg border border-background-200 bg-background-50 shadow-kbc-lg animate-slide-up"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-background-200 px-4 py-3">
              <p className="font-heading text-[14px] font-bold text-foreground-950">More</p>
              <button
                type="button"
                aria-label="Close more navigation"
                onClick={() => setMoreOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-lg text-foreground-500 hover:bg-background-100"
              >
                <i className="ri-close-line"></i>
              </button>
            </div>
            <div className="kbc-scroll max-h-[calc(60vh-3.5rem)] overflow-y-auto p-2">
              {NAV_GROUPS.map((group) => {
                const items = group.items.filter((item) => moreItems.some((more) => more.key === item.key));
                if (!items.length) return null;
                return (
                  <div key={group.title} className="mb-2 last:mb-0">
                    <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-foreground-400">
                      {group.title}
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      {items.map((item) => {
                        const active = isActive(pathname, item);
                        const badge = badges[item.key];
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => openPath(item.path)}
                            className={cn(
                              "relative flex min-h-12 items-center gap-2 rounded-md px-2.5 text-left text-[12px] font-semibold transition-colors",
                              active
                                ? "bg-primary-50 text-primary-700"
                                : "text-foreground-600 hover:bg-background-100",
                            )}
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background-100 text-lg">
                              <i className={item.icon}></i>
                            </span>
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {badge && showBadges ? (
                              <span className="rounded-full bg-primary-100 px-1.5 py-0.5 text-[10px] font-bold text-primary-700">
                                {badgeText(badge)}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-[60] border-t border-background-200 bg-background-50/95 px-2 pt-1.5 shadow-[0_-10px_30px_rgba(26,14,61,0.08)] backdrop-blur lg:hidden"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
        aria-label="Mobile navigation"
      >
        <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((item) => {
            if (item.key === "more") {
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setMoreOpen((open) => !open)}
                  className={cn(
                    "relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1.5 text-[10px] font-bold transition-colors",
                    moreActive || moreOpen
                      ? "bg-primary-50 text-primary-700"
                      : "text-foreground-500 hover:bg-background-100",
                  )}
                >
                  <span className="flex h-6 w-6 items-center justify-center text-xl">
                    <i className={item.icon}></i>
                  </span>
                  <span className="w-full truncate text-center leading-tight">{item.label}</span>
                </button>
              );
            }

            const badge = badges[item.key];
            return (
              <NavLink
                key={item.key}
                to={item.path}
                end={item.path === "/"}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1.5 text-[10px] font-bold transition-colors",
                    isActive
                      ? "bg-primary-50 text-primary-700"
                      : "text-foreground-500 hover:bg-background-100",
                  )
                }
              >
                <span className="relative flex h-6 w-6 items-center justify-center text-xl">
                  <i className={item.icon}></i>
                  {badge && showBadges ? (
                    <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-[9px] font-bold leading-none text-background-50">
                      {badgeText(badge)}
                    </span>
                  ) : null}
                </span>
                <span className="w-full truncate text-center leading-tight">{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </>
  );
}
