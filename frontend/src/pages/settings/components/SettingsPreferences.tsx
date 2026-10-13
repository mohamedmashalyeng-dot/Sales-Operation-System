import { Card, CardBody, CardHeader } from "@/components/base/Card";
import Button from "@/components/base/Button";
import Select from "@/components/base/Select";
import Toggle from "@/components/base/Toggle";
import { LANDING_OPTIONS, type DisplayPrefs, type NotificationPrefs } from "@/hooks/useLocalPrefs";

interface SettingsPreferencesProps {
  notifications: NotificationPrefs;
  display: DisplayPrefs;
  onNotificationChange: (patch: Partial<NotificationPrefs>) => void;
  onDisplayChange: (patch: Partial<DisplayPrefs>) => void;
  onReset: () => void;
}

export default function SettingsPreferences({
  notifications,
  display,
  onNotificationChange,
  onDisplayChange,
  onReset,
}: SettingsPreferencesProps) {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader
          icon="ri-notification-3-line"
          title="Notification preferences"
          subtitle="Stored locally in this browser (demonstration only)"
        />
        <CardBody className="pt-2">
          <div className="divide-y divide-background-200">
            <Toggle
              label="In-app notifications"
              description="Show the notification bell and drawer activity."
              checked={notifications.inApp}
              onChange={(v) => onNotificationChange({ inApp: v })}
            />
            <Toggle
              label="Email notifications"
              description="Simulated — no email is actually delivered in demo mode."
              checked={notifications.email}
              onChange={(v) => onNotificationChange({ email: v })}
            />
            <Toggle
              label="Overdue reminders"
              description="Flag overdue tasks and response-SLA breaches prominently."
              checked={notifications.overdueReminders}
              onChange={(v) => onNotificationChange({ overdueReminders: v })}
            />
            <Toggle
              label="Daily digest"
              description="A single morning summary of your day (simulated)."
              checked={notifications.dailyDigest}
              onChange={(v) => onNotificationChange({ dailyDigest: v })}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon="ri-layout-grid-line"
          iconTone="secondary"
          title="Workspace display"
          subtitle="How the workspace looks and opens"
          action={
            <Button variant="ghost" size="sm" leftIcon={<i className="ri-refresh-line"></i>} onClick={onReset}>
              Reset
            </Button>
          }
        />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Table density"
              value={display.density}
              onChange={(v) => onDisplayChange({ density: v as DisplayPrefs["density"] })}
              options={[
                { value: "compact", label: "Compact" },
                { value: "comfortable", label: "Comfortable" },
                { value: "spacious", label: "Spacious" },
              ]}
            />
            <Select
              label="Default landing page"
              value={display.defaultLanding}
              onChange={(v) => onDisplayChange({ defaultLanding: v })}
              options={LANDING_OPTIONS}
            />
          </div>
          <Toggle
            label="Show navigation badges"
            description="Display live counts on sidebar items."
            checked={display.showBadges}
            onChange={(v) => onDisplayChange({ showBadges: v })}
          />
          <p className="rounded-md bg-background-100 px-3 py-2 text-[11px] leading-snug text-foreground-500">
            Density changes table and list spacing across the whole workspace immediately. The landing
            page applies only when opening the workspace root. All preferences persist in localStorage
            so they survive a refresh.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
