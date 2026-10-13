import { useNavigate } from "react-router-dom";
import Avatar from "@/components/base/Avatar";
import Badge, { type BadgeTone } from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import { useToast } from "@/components/base/Toast";
import type { Lead } from "@/pages/today/types";

const STAGE_TONES: Record<string, BadgeTone> = {
  New: "primary",
  Contacted: "secondary",
  Qualified: "accent",
  "Proposal sent": "warning",
  Nurture: "neutral",
};

const PRIORITY_TONES: Record<string, BadgeTone> = {
  High: "danger",
  Medium: "warning",
  Low: "neutral",
};

export default function PriorityLeads({ leads }: { leads: Lead[] }) {
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleAction = (lead: Lead, action: string) => {
    toast({
      title: `${action} — ${lead.name}`,
      message: "Prototype action. No call or email was actually sent.",
      tone: "info",
    });
  };

  return (
    <Card>
      <CardHeader
        icon="ri-contacts-book-2-line"
        iconTone="accent"
        title="Priority leads"
        subtitle="Leads that need a fast follow-up"
        action={
          <Button
            variant="ghost"
            size="sm"
            rightIcon={<i className="ri-arrow-right-s-line"></i>}
            onClick={() => navigate("/leads")}
          >
            View all
          </Button>
        }
      />
      {leads.length === 0 ? (
        <EmptyState
          icon="ri-user-search-line"
          title="No leads match the filters"
          message="Try widening the programme, owner or search filters."
        />
      ) : (
        <ul className="divide-y divide-background-200">
          {leads.map((lead) => (
            <li key={lead.id} className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center">
              <button
                type="button"
                onClick={() => navigate(`/leads/${lead.id}`)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
              >
                <Avatar name={lead.name} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-foreground-900 hover:text-primary-600">
                      {lead.name}
                    </span>
                    {lead.overdue ? (
                      <Badge tone="danger" dot>
                        Overdue
                      </Badge>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-foreground-500">
                    {lead.programme} · {lead.intake}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={STAGE_TONES[lead.stage] || "neutral"}>{lead.stage}</Badge>
                    <Badge tone={PRIORITY_TONES[lead.priority]}>{lead.priority} priority</Badge>
                    <span className="text-[11px] text-foreground-400">· {lead.source}</span>
                  </span>
                </span>
              </button>

              <div className="flex items-center justify-between gap-3 lg:justify-end lg:w-[22rem]">
                <div className="min-w-0 text-left lg:text-right">
                  <p className="truncate text-[11px] font-medium text-foreground-400">
                    Owner · {lead.owner}
                  </p>
                  <p className="truncate text-[12px] font-semibold text-foreground-700">
                    {lead.nextAction}
                  </p>
                  <p className="truncate text-[11px] text-foreground-400">
                    Last contact {lead.lastContact}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Call ${lead.name}`}
                    title="Log a call"
                    onClick={() => handleAction(lead, "Log a call")}
                  >
                    <i className="ri-phone-line"></i>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Email ${lead.name}`}
                    title="Send email"
                    onClick={() => handleAction(lead, "Send email")}
                  >
                    <i className="ri-mail-send-line"></i>
                  </Button>
                  <Button
                    variant="subtle"
                    size="sm"
                    className="hidden xl:inline-flex"
                    onClick={() => navigate(`/leads/${lead.id}`)}
                  >
                    Open
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}