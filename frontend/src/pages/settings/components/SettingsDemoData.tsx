import { useRef, useState } from "react";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import Modal from "@/components/base/Modal";
import { useToast } from "@/components/base/Toast";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { downloadTextFile } from "@/utils/download";
import { formatDateTime, relativeTime } from "@/utils/format";

export default function SettingsDemoData() {
  const {
    state,
    schemaVersion,
    storageAvailable,
    exportDemoData,
    importDemoData,
    resetDemoData,
  } = useWorkspace();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const migration = state.lastMigration;
  const lastChange = state.activity[0]?.createdAt;

  const counts = [
    { label: "Leads", value: state.leads.length, icon: "ri-contacts-book-2-line" },
    { label: "Emails", value: state.threads.length, icon: "ri-inbox-archive-line" },
    { label: "Tasks", value: state.tasks.length, icon: "ri-checkbox-multiple-line" },
    { label: "Applications", value: state.applications.length, icon: "ri-file-list-3-line" },
    { label: "Events", value: state.events.length, icon: "ri-calendar-event-line" },
    { label: "Touchpoints", value: state.touchpoints.length, icon: "ri-flow-chart" },
    { label: "Calls", value: state.calls.length, icon: "ri-phone-line" },
    { label: "Activity entries", value: state.activity.length, icon: "ri-pulse-line" },
  ];

  const handleExport = () => {
    downloadTextFile(
      `kbc-workspace-export-${new Date().toISOString().slice(0, 10)}.json`,
      exportDemoData(),
    );
    toast({
      title: "Workspace data exported",
      message: "A JSON backup of the whole workspace has been downloaded.",
      tone: "success",
    });
  };

  const handleImportClick = () => fileInput.current?.click();

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const result = importDemoData(text);
      if (result.ok) {
        toast({
          title: "Backup imported",
          message: result.migrated
            ? "The backup was from an older version and was upgraded safely."
            : "The workspace now reflects the imported backup.",
          tone: "success",
        });
      } else {
        toast({
          title: "Import failed",
          message: result.error ?? "That backup could not be imported.",
          tone: "error",
        });
      }
    } catch {
      toast({
        title: "Import failed",
        message: "That file could not be read.",
        tone: "error",
      });
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const handleReset = () => {
    resetDemoData();
    setConfirmOpen(false);
    toast({
      title: "Local workspace cleared",
      message: "The browser workspace has been cleared. Backend records will load when available.",
      tone: "success",
    });
  };

  return (
    <Card>
      <CardHeader
        icon="ri-database-2-line"
        iconTone="accent"
        title="Workspace data"
        subtitle="Local browser cache and backend-loaded records"
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatusTile
            icon="ri-code-s-slash-line"
            label="Schema version"
            value={`v${schemaVersion}`}
            hint="Current workspace data model"
          />
          <StatusTile
            icon="ri-history-line"
            label="Last migration"
            value={migration ? `v${migration.fromVersion} -> v${migration.toVersion}` : "None needed"}
            hint={migration ? formatDateTime(migration.at) : "Data already up to date"}
          />
          <StatusTile
            icon={storageAvailable ? "ri-hard-drive-2-line" : "ri-error-warning-line"}
            tone={storageAvailable ? "primary" : "danger"}
            label="Persistence"
            value={storageAvailable ? "Active" : "Unavailable"}
            hint={
              storageAvailable
                ? lastChange
                  ? `Saved ${relativeTime(lastChange)}`
                  : "Saved in this browser"
                : "This browser is blocking local storage"
            }
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {counts.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-background-200 bg-background-50 p-3"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-background-100 text-base text-foreground-600">
                <i className={stat.icon}></i>
              </span>
              <p className="mt-2 font-heading text-lg font-bold leading-none text-foreground-900">
                {stat.value}
              </p>
              <p className="mt-1 text-[11px] font-medium text-foreground-500">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-background-200 bg-background-100 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-background-50 text-lg text-primary-600">
              <i className="ri-hard-drive-2-line"></i>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-foreground-900">
                Stored locally in this browser
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-foreground-500">
                Local edits are saved to localStorage before backend data is loaded. Backend records
                are not deleted by clearing this browser cache.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-background-200 bg-background-50 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-100 text-lg text-accent-700">
              <i className="ri-archive-2-line"></i>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-foreground-900">Backup &amp; restore</p>
              <p className="mt-0.5 text-[12px] leading-snug text-foreground-500">
                Export the full workspace as JSON, then import it later to restore local work.
                Imported files are validated before they replace anything.
              </p>
              <div className="mt-3 flex flex-wrap gap-2.5">
                <Button
                  variant="outline"
                  leftIcon={<i className="ri-download-2-line"></i>}
                  onClick={handleExport}
                >
                  Export JSON
                </Button>
                <Button
                  variant="outline"
                  leftIcon={<i className="ri-upload-2-line"></i>}
                  onClick={handleImportClick}
                >
                  Import JSON
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => handleImportFile(e.target.files?.[0])}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-red-800">Clear local workspace data</p>
            <p className="mt-0.5 text-[12px] leading-snug text-red-700/80">
              Remove any browser-cached records, activity and audit entries. This does not delete
              backend records.
            </p>
          </div>
          <Button
            variant="danger"
            leftIcon={<i className="ri-refresh-line"></i>}
            onClick={() => setConfirmOpen(true)}
          >
            Clear local data
          </Button>
        </div>
      </CardBody>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        size="sm"
        title="Clear local workspace data?"
        description="This removes the browser-cached workspace copy and cannot be undone."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              leftIcon={<i className="ri-refresh-line"></i>}
              onClick={handleReset}
            >
              Yes, clear it
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-foreground-600">
          Your locally cached leads, emails, tasks, applications, event outcomes, calls and
          touchpoints will be removed from this browser. Export a backup first if you want to keep
          local changes.
        </p>
      </Modal>
    </Card>
  );
}

function StatusTile({
  icon,
  label,
  value,
  hint,
  tone = "secondary",
}: {
  icon: string;
  label: string;
  value: string;
  hint: string;
  tone?: "primary" | "secondary" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "bg-red-100 text-red-600"
      : tone === "primary"
        ? "bg-primary-100 text-primary-700"
        : "bg-secondary-100 text-secondary-700";
  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-4">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-md text-base ${toneClass}`}>
          <i className={icon}></i>
        </span>
        <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
      </div>
      <p className="mt-2 text-[15px] font-bold text-foreground-900">{value}</p>
      <p className="mt-0.5 text-[11.5px] text-foreground-500">{hint}</p>
    </div>
  );
}
