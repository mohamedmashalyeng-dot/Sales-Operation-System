import { useMemo } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { OPEN_COMMERCIAL_STAGES } from "@/config/commercial";

/** Live sidebar badges derived from the shared workspace store. */
export function useNavBadges(): Record<string, number> {
  const { state } = useWorkspace();
  const { canSeeOwner } = usePermissions();

  return useMemo(() => {
    const now = Date.now();
    const leads = state.leads.filter((l) => canSeeOwner(l.ownerId));
    const threads = state.threads.filter((t) => !t.trashed && canSeeOwner(t.ownerId));
    const openTasks = state.tasks.filter((t) => t.status === "open" && canSeeOwner(t.ownerId));
    const applications = state.applications.filter((a) => canSeeOwner(a.ownerId));

    const commercial = state.commercialOpportunities.filter((c) =>
      canSeeOwner(state.leads.find((l) => l.id === c.leadId)?.ownerId ?? c.commercialOwnerId),
    );

    return {
      leads: leads.filter(
        (l) =>
          l.stage !== "Won" &&
          l.stage !== "Lost" &&
          new Date(l.nextActionAt).getTime() < now,
      ).length,
      inbox: threads.filter((t) => t.responseState === "unanswered").length,
      planner: openTasks.filter((t) => new Date(t.dueAt).getTime() < now).length,
      applications: applications.filter(
        (a) => a.status === "Submitted" || a.status === "Under review",
      ).length,
      events: state.events.filter((e) => e.registrations.some((r) => r.outcome === "pending")).length,
      commercial: commercial.filter((c) => OPEN_COMMERCIAL_STAGES.includes(c.stage)).length,
    };
  }, [state.leads, state.threads, state.tasks, state.applications, state.events, state.commercialOpportunities, canSeeOwner]);
}