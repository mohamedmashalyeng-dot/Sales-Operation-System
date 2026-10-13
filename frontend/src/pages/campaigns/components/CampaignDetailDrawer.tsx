import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import Drawer from "@/components/base/Drawer";
import EmptyState from "@/components/base/EmptyState";
import Select from "@/components/base/Select";
import { useToast } from "@/components/base/Toast";
import {
  CAMPAIGN_STAGE_TONES,
  CAMPAIGN_TYPE_ICONS,
  PARTICIPATION_OUTCOMES,
  PARTICIPATION_TONES,
  type ParticipationOutcome,
} from "@/config/marketing";
import AudienceImportPanel from "@/pages/campaigns/components/AudienceImportPanel";
import { campaignStats, canSendCampaign } from "@/store/actions/marketing";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { EventCampaign } from "@/store/types";
import { formatDateTime } from "@/utils/format";

type Tab = "overview" | "audience" | "compose" | "recipients";

export default function CampaignDetailDrawer({
  campaign,
  onClose,
  canManage,
}: {
  campaign: EventCampaign | null;
  onClose: () => void;
  canManage: boolean;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { state, userName, setCampaignStage, sendCampaign, updateCampaign, updateCampaignRecipient } =
    useWorkspace();
  const [tab, setTab] = useState<Tab>("overview");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (campaign) {
      setSubject(campaign.subject);
      setBody(campaign.body);
      setTab("overview");
    }
  }, [campaign]);

  if (!campaign) return null;

  const stats = campaignStats(campaign);
  const event = state.events.find((e) => e.id === campaign.eventId);
  const sendable = canSendCampaign(campaign);

  const send = () => {
    sendCampaign(campaign.id);
    toast({
      title: "Campaign sent (simulated)",
      message: `An Eventbrite invitation would be sent to ${stats.valid} valid contacts. No email is actually sent.`,
      tone: "success",
    });
  };

  const saveCompose = () => {
    updateCampaign(campaign.id, { subject, body });
    toast({ title: "Invitation saved", tone: "success" });
  };

  return (
    <Drawer
      open={Boolean(campaign)}
      onClose={onClose}
      widthClass="max-w-3xl"
      title={campaign.name}
      subtitle={`${campaign.type} · ${campaign.platform}`}
      footer={
        canManage ? (
          <>
            {campaign.stage !== "Cancelled" && campaign.stage !== "Sent" ? (
              <Button variant="outline" size="sm" onClick={() => setCampaignStage(campaign.id, "Cancelled")}>
                Cancel campaign
              </Button>
            ) : null}
            {campaign.stage === "Audience Imported" ? (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<i className="ri-checkbox-circle-line"></i>}
                onClick={() => {
                  setCampaignStage(campaign.id, "Ready to Send");
                  toast({ title: "Marked ready to send", tone: "success" });
                }}
              >
                Mark ready to send
              </Button>
            ) : null}
            <Button
              leftIcon={<i className="ri-send-plane-line"></i>}
              size="sm"
              disabled={!sendable}
              onClick={send}
            >
              Send invitation (simulated)
            </Button>
          </>
        ) : null
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={CAMPAIGN_STAGE_TONES[campaign.stage]} dot>
            {campaign.stage}
          </Badge>
          <Badge tone="neutral" icon={CAMPAIGN_TYPE_ICONS[campaign.type]}>
            {campaign.type}
          </Badge>
          <span className="text-[12px] text-foreground-400">{campaign.id}</span>
        </div>

        <div className="kbc-no-scrollbar overflow-x-auto">
          <div className="inline-flex items-center gap-1 rounded-full bg-background-200 p-1">
            {(["overview", "audience", "compose", "recipients"] as Tab[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold capitalize transition-colors ${
                  tab === key ? "bg-background-50 text-foreground-900" : "text-foreground-500 hover:text-foreground-800"
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        {tab === "overview" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label="Original acquisition provider" value={campaign.acquisitionProvider} />
              <Field label="CRM system" value={campaign.crmSystem} />
              <Field label="Marketing platform" value={campaign.platform} />
              <Field label="Communication channel" value={campaign.channel} />
              <Field label="Owner" value={userName(campaign.ownerId)} />
              <Field label="Created" value={formatDateTime(campaign.createdAt)} />
              <Field
                label="Linked event"
                value={event ? `${event.name}${event.eventbriteRef ? ` · ${event.eventbriteRef}` : ""}` : "No linked event"}
              />
              <Field
                label="Information session (Zoom)"
                value={event?.informationSessionAt ? formatDateTime(event.informationSessionAt) : "Not scheduled"}
              />
              <Field label="Sent (simulated)" value={campaign.sentAt ? formatDateTime(campaign.sentAt) : "Not sent"} />
              <Field label="Audience file" value={campaign.audienceFileName ?? "Not imported"} />
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Mini label="Recipients" value={stats.total} />
              <Mini label="Invited" value={stats.invited + stats.registered + stats.attended} />
              <Mini label="Registered" value={stats.registered} />
              <Mini label="Attended" value={stats.attended} />
            </div>

            {event ? (
              <div className="rounded-lg border border-background-200 bg-background-100/60 p-3">
                <p className="text-[12px] font-semibold text-foreground-800">Related event registrations</p>
                <p className="mt-1 text-[12px] text-foreground-600">
                  {event.registrations.length} registrations on {event.name}. Registration and attendance are
                  tracked separately — a recipient in the audience is not automatically registered.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  leftIcon={<i className="ri-calendar-event-line"></i>}
                  onClick={() => navigate(`/events/${event.id}`)}
                >
                  Open event
                </Button>
              </div>
            ) : null}

            {campaign.notes ? (
              <p className="rounded-md bg-background-100 px-3 py-2 text-[12px] text-foreground-600">{campaign.notes}</p>
            ) : null}
          </div>
        ) : null}

        {tab === "audience" ? <AudienceImportPanel campaign={campaign} canManage={canManage} /> : null}

        {tab === "compose" ? (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
                Subject
              </label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={!canManage}
                className="h-9 w-full rounded-md border border-background-300 bg-background-50 px-3 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
                Body
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={!canManage}
                rows={9}
                className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:opacity-60"
              />
            </div>
            {canManage ? (
              <Button leftIcon={<i className="ri-save-line"></i>} onClick={saveCompose}>
                Save invitation
              </Button>
            ) : (
              <p className="text-[12px] text-foreground-500">Read-only for your role.</p>
            )}
          </div>
        ) : null}

        {tab === "recipients" ? (
          campaign.recipients.length === 0 ? (
            <EmptyState
              icon="ri-group-line"
              title="No recipients yet"
              message="Import an audience from the Audience tab to add recipients."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-background-200">
              <table className="w-full text-left">
                <thead className="bg-background-100">
                  <tr className="text-[11px] uppercase tracking-wide text-foreground-500">
                    <th className="px-3 py-2 font-semibold">Recipient</th>
                    <th className="px-3 py-2 font-semibold">Participation</th>
                    <th className="px-3 py-2 font-semibold">Email tracking</th>
                    <th className="px-3 py-2 font-semibold"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-background-200">
                  {campaign.recipients.map((r) => (
                    <tr key={r.id} className="align-top text-[12.5px]">
                      <td className="px-3 py-2">
                        <p className="font-semibold text-foreground-900">{r.name}</p>
                        <p className="text-[11px] text-foreground-500">{r.email}</p>
                        {r.duplicate ? <Badge tone="warning">Duplicate of earlier row</Badge> : null}
                        {!r.valid ? <Badge tone="danger">Invalid email</Badge> : null}
                      </td>
                      <td className="px-3 py-2">
                        {canManage ? (
                          <Select
                            size="sm"
                            className="w-[11rem]"
                            value={r.outcome}
                            onChange={(v) =>
                              updateCampaignRecipient(campaign.id, r.id, {
                                outcome: v as ParticipationOutcome,
                                registeredAt: v === "Registered" ? new Date().toISOString() : r.registeredAt,
                              })
                            }
                            options={PARTICIPATION_OUTCOMES.map((o) => ({ value: o, label: o }))}
                          />
                        ) : (
                          <Badge tone={PARTICIPATION_TONES[r.outcome]}>{r.outcome}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.delivered ? <Badge tone="secondary">Delivered</Badge> : null}
                          {r.opened ? <Badge tone="primary">Opened</Badge> : null}
                          {r.clicked ? <Badge tone="accent">Clicked</Badge> : null}
                          {!r.delivered && !r.opened && !r.clicked ? (
                            <span className="text-[11px] text-foreground-400">No tracking recorded</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.leadId ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            leftIcon={<i className="ri-route-line"></i>}
                            onClick={() => navigate(`/leads/${r.leadId}`)}
                          >
                            Lead journey
                          </Button>
                        ) : (
                          <span className="text-[11px] text-foreground-400">No lead record</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </div>
    </Drawer>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-medium text-foreground-900">{value}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-3 text-center">
      <p className="font-heading text-xl font-bold leading-none text-foreground-900">{value}</p>
      <p className="mt-1 text-[11px] font-medium text-foreground-500">{label}</p>
    </div>
  );
}