import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import GlobalSearch from "@/components/feature/GlobalSearch";
import MigrationNoticeBanner from "@/components/feature/MigrationNoticeBanner";
import MobileTabBar from "@/components/feature/MobileTabBar";
import NotificationsDrawer from "@/components/feature/NotificationsDrawer";
import Sidebar from "@/components/feature/Sidebar";
import Topbar from "@/components/feature/Topbar";
import PostCallInbox from "@/components/feature/PostCallInbox";
import { useToast } from "@/components/base/Toast";
import { pathForLanding, usePreferences } from "@/hooks/useLocalPrefs";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { RoleId } from "@/config/permissions";
import ModuleGuard from "@/components/feature/ModuleGuard";

const ROLE_LANDING: Record<RoleId, string> = {
  sales: "/leads",
  enrolment: "/applications",
  manager: "/",
  admin: "/admin",
};

const DEVELOPER_REFRESH_FALLBACK = "/leads";

export default function AppShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { roleId } = useWorkspace();
  const moduleKey = /^\/(campaigns|sources|attribution|future-intake)(\/|$)/.test(pathname) || /^\/zoom\/calls\/[^/]+$/.test(pathname) ? "leads" : pathname.split("/")[1] || "today";
  const { toast } = useToast();
  useEffect(() => {
    const listener = (event: Event) => toast({ title: 'Task update failed', message: (event as CustomEvent<string>).detail, tone: 'error' });
    window.addEventListener('kbc:workflow-error', listener);
    return () => window.removeEventListener('kbc:workflow-error', listener);
  }, [toast]);
  const { prefs } = usePreferences();
  const landingApplied = useRef(false);
  const lastRole = useRef<RoleId | null>(null);

  const resolveLanding = () =>
    prefs.display.defaultLanding !== "today"
      ? pathForLanding(prefs.display.defaultLanding)
      : ROLE_LANDING[roleId] ?? "/";

  useEffect(() => {
    // Apply the resolved landing on first mount when the user is at the root.
    // A browser refresh must never reopen the Developer module just because that
    // URL was left in the address bar.
    if (!landingApplied.current) {
      landingApplied.current = true;
      lastRole.current = roleId;
      const dest = resolveLanding();
      if (pathname === "/developer" || pathname.startsWith("/developer/")) {
        navigate(DEVELOPER_REFRESH_FALLBACK, { replace: true });
        return;
      }
      if (pathname === "/" && dest !== "/") navigate(dest, { replace: true });
      return;
    }
    // Re-resolve the landing whenever the demo role changes.
    if (lastRole.current !== roleId) {
      lastRole.current = roleId;
      if (pathname === "/") navigate(resolveLanding(), { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId, prefs.display.defaultLanding, pathname]);

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("kbc-sidebar") === "collapsed",
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("kbc-sidebar", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background-100">
      <div className="hidden lg:flex">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MigrationNoticeBanner />
        <Topbar
          onOpenSearch={() => setSearchOpen(true)}
          onOpenNotifications={() => setNotificationsOpen(true)}
        />
        <PostCallInbox />
        <main className="kbc-scroll flex-1 overflow-x-hidden overflow-y-auto pb-20 lg:pb-0">
          <ModuleGuard navKey={moduleKey}><Outlet /></ModuleGuard>
        </main>
      </div>

      <MobileTabBar />

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <NotificationsDrawer
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
      />
    </div>
  );
}
