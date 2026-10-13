import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/components/base/Button";
import Drawer from "@/components/base/Drawer";
import Tabs from "@/components/base/Tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { ActivityTone } from "@/store/types";
import { cn, relativeTime } from "@/utils/format";

const TONE_STYLES: Record<ActivityTone, { icon: string; wrap: string }> = {
  danger: { icon: "ri-error-warning-line", wrap: "bg-red-100 text-red-600" },
  secondary: { icon: "ri-notification-3-line", wrap: "bg-secondary-100 text-secondary-900" },
  primary: { icon: "ri-information-line", wrap: "bg-primary-100 text-primary-700" },
  accent: { icon: "ri-sparkling-2-line", wrap: "bg-accent-100 text-accent-900" },
  success: { icon: "ri-checkbox-circle-line", wrap: "bg-green-100 text-green-700" },
};

const MODULE_ROUTE: Record<string, string> = {
  Inbox: "/inbox",
  Leads: "/leads",
  Planner: "/planner",
  Events: "/events",
  Applications: "/applications",
  Integrations: "/zoho",
  Zoom: "/planner",
};

interface NotificationsDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function NotificationsDrawer({ open, onClose }: NotificationsDrawerProps) {
  const { state } = useWorkspace();
  const { seesAll } = usePermissions();
  const navigate = useNavigate();
  const [tab, setTab] = useState("all");

  // Notifications mentioning team-wide integration/system events are shown to
  // manager and admin roles; operational roles see the operational ones.
  const visible = seesAll
    ? state.notifications
    : state.notifications.filter((n) => n.module !== "Integrations");

  const unread = visible.filter((n) => !n.read);
  const list = tab === "unread" ? unread : visible;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Notifications"
      subtitle="Activity across CRM, Inbox, Events and Applications"
      widthClass="max-w-md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button variant="outline" size="sm" leftIcon={<i className="ri-check-double-line"></i>}>
            Mark all as read
          </Button>
        </>
      }
    >
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        items={[
          { value: "all", label: "All", count: visible.length },
          { value: "unread", label: "Unread", count: unread.length },
        ]}
      />
      <div className="space-y-2">
        {list.map((item) => {
          const tone = TONE_STYLES[item.tone];
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                navigate(MODULE_ROUTE[item.module] ?? "/");
                onClose();
              }}
              className="flex w-full cursor-pointer items-start gap-3 rounded-lg border border-background-200 bg-background-50 p-3 text-left transition-colors hover:border-primary-200 hover:bg-primary-50/40"
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-base",
                  tone.wrap,
                )}
              >
                <i className={tone.icon}></i>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[13px] font-semibold text-foreground-900">
                    {item.title}
                  </p>
                  <span className="shrink-0 text-[10px] font-medium text-foreground-400">
                    {relativeTime(item.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] leading-snug text-foreground-500">
                  {item.message}
                </p>
                <span className="mt-1.5 inline-block rounded-full bg-background-200 px-2 py-0.5 text-[10px] font-semibold text-foreground-600">
                  {item.module}
                </span>
              </div>
              {!item.read ? (
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-500" />
              ) : null}
            </button>
          );
        })}
      </div>
    </Drawer>
  );
}
