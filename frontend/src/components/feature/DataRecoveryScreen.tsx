import { useState } from "react";
import Button from "@/components/base/Button";
import { BACKUP_STORAGE_KEY, type BootIssue } from "@/store/migrations";
import { downloadTextFile } from "@/utils/download";

interface DataRecoveryScreenProps {
  issue: BootIssue;
  /** Re-attempts the automatic upgrade. Returns true when it succeeded. */
  onRetry: () => boolean;
  /** Explicitly discards the stored browser data and returns to an empty workspace. */
  onReset: () => void;
}

function timestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function readBackup(): string | null {
  try {
    return localStorage.getItem(BACKUP_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Shown when the stored browser workspace cannot be upgraded safely.
 * The original data is preserved until the user explicitly resets; every
 * recovery path (export, retry, reset) is offered here.
 */
export default function DataRecoveryScreen({ issue, onRetry, onReset }: DataRecoveryScreenProps) {
  const [status, setStatus] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const hasBackup = readBackup() !== null;

  const handleExportCurrent = () => {
    downloadTextFile(`kbc-workspace-saved-${timestamp()}.json`, issue.raw);
    setStatus({
      tone: "info",
      text: "Your saved data has been downloaded. Keep it somewhere safe before continuing.",
    });
  };

  const handleExportBackup = () => {
    const backup = readBackup();
    if (!backup) return;
    downloadTextFile(`kbc-workspace-backup-${timestamp()}.json`, backup);
    setStatus({ tone: "info", text: "Your most recent automatic backup has been downloaded." });
  };

  const handleRetry = () => {
    const ok = onRetry();
    if (!ok) {
      setStatus({
        tone: "error",
        text: "The saved data still could not be upgraded automatically. You can export it, or clear the local workspace.",
      });
    }
  };

  const handleReset = () => {
    onReset();
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background-100 px-4 py-10">
      <div className="w-full max-w-[640px] rounded-lg border border-background-200 bg-background-50 p-6 md:p-8">
        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-100 text-2xl text-amber-600">
          <i className="ri-error-warning-line"></i>
        </span>
        <h1 className="mt-4 font-heading text-xl font-extrabold text-foreground-950">
          We couldn&apos;t safely update your saved data
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-foreground-600">
          {issue.reason} Your original data has been kept exactly as it was — nothing was deleted or
          replaced. Choose how you would like to continue.
        </p>

        <div className="mt-5 rounded-lg border border-background-200 bg-background-100 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">
            What you can do
          </p>
          <ul className="mt-2 space-y-1.5 text-[12.5px] text-foreground-600">
            <li className="flex items-start gap-2">
              <i className="ri-download-2-line mt-0.5 text-base text-primary-600"></i>
              <span>Download a copy of the saved data so nothing is lost.</span>
            </li>
            <li className="flex items-start gap-2">
              <i className="ri-refresh-line mt-0.5 text-base text-primary-600"></i>
              <span>Retry the automatic update — it is safe to run more than once.</span>
            </li>
            <li className="flex items-start gap-2">
              <i className="ri-restart-line mt-0.5 text-base text-accent-600"></i>
              <span>Clear the local workspace only if you are happy to discard browser-cached changes.</span>
            </li>
          </ul>
        </div>

        {status ? (
          <div
            className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-[12.5px] ${
              status.tone === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-background-200 bg-background-100 text-foreground-600"
            }`}
          >
            <i
              className={`mt-0.5 text-base ${
                status.tone === "error" ? "ri-close-circle-line" : "ri-information-line"
              }`}
            ></i>
            <span>{status.text}</span>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2.5">
          <Button
            leftIcon={<i className="ri-download-2-line"></i>}
            onClick={handleExportCurrent}
          >
            Export saved data
          </Button>
          <Button
            variant="outline"
            leftIcon={<i className="ri-refresh-line"></i>}
            onClick={handleRetry}
          >
            Retry update
          </Button>
          {hasBackup ? (
            <Button
              variant="ghost"
              leftIcon={<i className="ri-history-line"></i>}
              onClick={handleExportBackup}
            >
              Download last backup
            </Button>
          ) : null}
        </div>

        <div className="mt-6 border-t border-background-200 pt-4">
          {confirmReset ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12.5px] text-foreground-600">
                This discards your browser-cached data and returns to an empty local workspace. This cannot be
                undone - export a copy first if you are unsure.
              </p>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfirmReset(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  leftIcon={<i className="ri-restart-line"></i>}
                  onClick={handleReset}
                >
                  Yes, reset
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="cursor-pointer text-[12.5px] font-semibold text-red-600 hover:text-red-700"
            >
              Clear local workspace...
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
