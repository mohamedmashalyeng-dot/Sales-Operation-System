import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "@/components/base/Badge";
import { normaliseEmail } from "@/config/marketing";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { Lead } from "@/store/types";
import { leadSessionGroup, registrationsByEmail, sessionGroupMeta } from "@/utils/conversion";

/**
 * Compact information-session participation badge for the lead header.
 *
 * Uses the SAME classification precedence as the reporting page so the badge and
 * Sources & Attribution never disagree. Attendance is only ever Attended / Did
 * Not Attend when explicitly recorded — a registration with no outcome stays
 * "Attendance Unknown" and is never read as "Did Not Attend". Participation is
 * optional and never affects apprenticeship eligibility.
 */
export default function SessionBadge({ lead }: { lead: Lead }) {
  const navigate = useNavigate();
  const { state } = useWorkspace();

  const regIndex = useMemo(() => registrationsByEmail(state.events), [state.events]);
  const group = leadSessionGroup(lead, regIndex);
  const meta = sessionGroupMeta(group);

  // Event ids this lead is registered on — used so the badge can open the real
  // event history when one exists.
  const eventIds = useMemo(() => {
    const ids: string[] = [];
    const email = normaliseEmail(lead.email);
    (Array.isArray(state.events) ? state.events : []).forEach((event) => {
      const registered = (Array.isArray(event.registrations) ? event.registrations : []).some(
        (reg) => normaliseEmail(reg.email) === email,
      );
      if (registered) ids.push(event.id);
    });
    return ids;
  }, [state.events, lead.email]);

  const tooltip = `${meta.description} Information sessions are optional and never affect eligibility or enrolment. Click to open the related event history.`;

  return (
    <button
      type="button"
      onClick={() => navigate(eventIds.length > 0 ? `/events/${eventIds[0]}` : "/events")}
      title={tooltip}
      aria-label={`Information session participation: ${meta.label}. ${tooltip}`}
      className="inline-flex cursor-pointer items-center rounded-full focus:outline-none focus:ring-2 focus:ring-primary-200"
    >
      <Badge tone={meta.tone} icon="ri-vidicon-line">
        Session {meta.letter !== "—" ? `${meta.letter} · ` : "· "}
        {meta.label}
      </Badge>
    </button>
  );
}