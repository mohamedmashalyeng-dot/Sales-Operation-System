import { useWorkspace } from "@/store/WorkspaceProvider";

/**
 * Small dismissible notice shown once after the stored dataset has been
 * successfully upgraded. It is not shown when no migration was needed.
 */
export default function MigrationNoticeBanner() {
  const { migrationNotice, dismissMigrationNotice } = useWorkspace();
  if (!migrationNotice) return null;

  return (
    <div className="flex items-start gap-3 border-b border-accent-200 bg-accent-50 px-4 py-2.5 md:px-6">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-base text-accent-600">
        <i className="ri-information-line"></i>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-foreground-800">
          Your saved workspace data was updated to the latest workspace version. Your changes have been
          preserved.
        </p>
        <p className="mt-0.5 text-[11.5px] text-foreground-500">
          Upgraded from schema v{migrationNotice.fromVersion} to v{migrationNotice.toVersion}. You can
          review or export it under Settings &gt; Workspace data.
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismissMigrationNotice}
        className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-base text-foreground-500 hover:bg-accent-100 hover:text-foreground-800"
      >
        <i className="ri-close-line"></i>
      </button>
    </div>
  );
}
