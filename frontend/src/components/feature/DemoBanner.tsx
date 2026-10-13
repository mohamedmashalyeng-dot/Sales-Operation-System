import { cn } from "@/utils/format";
import { useWorkspace } from "@/store/WorkspaceProvider";

export default function DemoBanner({ onDismiss }: { onDismiss: () => void }) {
  const { backendLoadedAt } = useWorkspace();

  return (
    <div className="flex shrink-0 items-center gap-2.5 bg-primary-950 px-4 py-2 text-background-100 md:px-6">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-base text-accent-400">
        <i className={backendLoadedAt ? "ri-database-2-line" : "ri-flask-line"}></i>
      </span>
      <p className="min-w-0 flex-1 truncate text-[12px] font-medium">
        <span className="font-bold text-accent-300">
          {backendLoadedAt ? "Connected workspace" : "Local workspace"}
        </span>
        <span className="hidden sm:inline">
          {" "}
          {backendLoadedAt
            ? "- showing backend data through the Readdy interface."
            : "- no backend records loaded yet. Sign in on the backend to hydrate live records."}
        </span>
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-base text-background-200 transition-colors hover:bg-primary-900 hover:text-background-50"
      >
        <i className="ri-close-line"></i>
      </button>
    </div>
  );
}

export function IntegrationDot({ status }: { status: "connected" | "attention" | "disconnected" }) {
  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full",
        status === "connected"
          ? "bg-green-500"
          : status === "attention"
            ? "bg-amber-500"
            : "bg-foreground-300",
      )}
    ></span>
  );
}
