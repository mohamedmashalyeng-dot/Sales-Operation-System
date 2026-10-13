import { useMemo, useState } from "react";
import Badge from "@/components/base/Badge";
import Tabs, { type TabItem } from "@/components/base/Tabs";
import SettingsDemoData from "@/pages/settings/components/SettingsDemoData";
import SettingsIntegrations from "@/pages/settings/components/SettingsIntegrations";
import SettingsPreferences from "@/pages/settings/components/SettingsPreferences";
import SettingsProfile from "@/pages/settings/components/SettingsProfile";
import SettingsUsers from "@/pages/settings/components/SettingsUsers";
import { usePreferences } from "@/hooks/useLocalPrefs";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/store/WorkspaceProvider";

export default function SettingsPage() {
  const { role } = useWorkspace();
  const { can } = usePermissions();
  const { prefs, updateNotifications, updateDisplay, reset } = usePreferences();
  const [tab, setTab] = useState("profile");

  const showAdmin = can("admin.view") || can("admin.manageUsers");

  const items: TabItem[] = useMemo(() => {
    const base: TabItem[] = [
      { value: "profile", label: "Profile & role", icon: "ri-user-settings-line" },
      { value: "preferences", label: "Preferences", icon: "ri-equalizer-line" },
      { value: "integrations", label: "Integrations", icon: "ri-plug-line" },
      { value: "data", label: "Workspace data", icon: "ri-database-2-line" },
    ];
    if (showAdmin) {
      base.push({ value: "users", label: "Users & permissions", icon: "ri-shield-user-line" });
    }
    return base;
  }, [showAdmin]);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600">
              Administration
            </p>
            <Badge tone={role.tone} icon={role.icon}>
              {role.name}
            </Badge>
          </div>
          <h1 className="mt-1 font-heading text-2xl font-extrabold text-foreground-950">Settings</h1>
          <p className="mt-1 text-[13px] text-foreground-500">
            Workspace preferences, local data and integration status
          </p>
        </div>
      </div>

      <div className="kbc-no-scrollbar overflow-x-auto pb-1">
        <Tabs items={items} value={tab} onChange={setTab} />
      </div>

      {tab === "profile" ? <SettingsProfile /> : null}
      {tab === "preferences" ? (
        <SettingsPreferences
          notifications={prefs.notifications}
          display={prefs.display}
          onNotificationChange={updateNotifications}
          onDisplayChange={updateDisplay}
          onReset={reset}
        />
      ) : null}
      {tab === "integrations" ? <SettingsIntegrations /> : null}
      {tab === "data" ? <SettingsDemoData /> : null}
      {tab === "users" && showAdmin ? <SettingsUsers /> : null}
    </div>
  );
}
