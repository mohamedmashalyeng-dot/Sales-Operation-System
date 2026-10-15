import { useState } from "react";
import Button from "@/components/base/Button";
import Modal from "@/components/base/Modal";
import { useToast } from "@/components/base/Toast";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { cn } from "@/utils/format";

type SyncKey = "sheet" | "eventbrite" | "zoom";
type SyncState = "idle" | "running" | "done" | "error";

const ACTIONS: { key: SyncKey; label: string; description: string; icon: string }[] = [
  {
    key: "sheet",
    label: "Import configured sheet",
    description: "Pull registrations from the Google Sheet configured on the backend.",
    icon: "ri-file-excel-2-line",
  },
  {
    key: "eventbrite",
    label: "Sync Eventbrite",
    description: "Pull events and registrations from the connected Eventbrite account.",
    icon: "ri-calendar-event-line",
  },
  {
    key: "zoom",
    label: "Sync Zoom",
    description: "Pull Zoom meetings and attendance records into Events.",
    icon: "ri-vidicon-line",
  },
];

const ENDPOINTS: Record<SyncKey, { path: string; body: Record<string, unknown> }> = {
  sheet: { path: "/api/events/import", body: { use_configured_sheet: true } },
  eventbrite: { path: "/api/integrations/eventbrite/sync", body: { max_events: 50 } },
  zoom: { path: "/api/integrations/zoom/sync", body: { max_events: 500 } },
};

export default function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const { logIntegrationEvent, refreshBackendWorkspace } = useWorkspace();
  const [states, setStates] = useState<Record<SyncKey, SyncState>>({
    sheet: "idle",
    eventbrite: "idle",
    zoom: "idle",
  });

  const run = async (key: SyncKey) => {
    setStates((prev) => ({ ...prev, [key]: "running" }));
    const endpoint = ENDPOINTS[key];
    try {
      const response = await fetch(endpoint.path, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(endpoint.body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || result?.message || "Sync failed.");
      await refreshBackendWorkspace();
      setStates((prev) => ({ ...prev, [key]: "done" }));
      const imported = Number(result.imported_events || result.imported || 0);
      const updated = Number(result.updated_events || result.updated || 0);
      const attendees = Number(result.imported_attendees || 0);
      logIntegrationEvent("synced", `Events - ${key}`, "primary");
      toast({
        title: "Sync complete",
        message: `${imported} imported, ${updated} updated${attendees ? `, ${attendees} attendees` : ""}.`,
        tone: "success",
      });
    } catch (error) {
      setStates((prev) => ({ ...prev, [key]: "error" }));
      toast({
        title: "Sync failed",
        message: error instanceof Error ? error.message : "The backend could not complete the sync.",
        tone: "error",
      });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import & sync registrations"
      description="Pull event records into the shared workspace dataset."
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-2.5">
        {ACTIONS.map((action) => {
          const state = states[action.key];
          return (
            <div
              key={action.key}
              className="flex items-center gap-3 rounded-lg border border-background-200 bg-background-50 p-3.5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-background-100 text-lg text-foreground-600">
                <i className={action.icon}></i>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-foreground-900">{action.label}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">
                  {action.description}
                </p>
              </div>
              <Button
                variant={state === "done" ? "secondary" : state === "error" ? "danger" : "outline"}
                size="sm"
                className="shrink-0"
                loading={state === "running"} disabled={state === "running"}
                leftIcon={
                  state === "running" ? (
                    <i className="ri-loader-4-line animate-spin"></i>
                  ) : state === "done" ? (
                    <i className="ri-check-line"></i>
                  ) : state === "error" ? (
                    <i className="ri-error-warning-line"></i>
                  ) : (
                    <i className="ri-refresh-line"></i>
                  )
                }
                onClick={() => run(action.key)}
              >
                {state === "running" ? "Syncing..." : state === "done" ? "Synced" : state === "error" ? "Retry" : "Run"}
              </Button>
            </div>
          );
        })}
        <p className={cn("flex items-center gap-1.5 rounded-md bg-primary-50 px-3 py-2 text-[11px] font-medium text-primary-800")}>
          <i className="ri-database-2-line"></i>
          Imported records are saved by the backend, then this workspace reloads the shared dataset.
        </p>
      </div>
    </Modal>
  );
}
