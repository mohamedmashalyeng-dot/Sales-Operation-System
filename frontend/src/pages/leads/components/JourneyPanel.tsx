import { useMemo, useState } from "react";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import { useToast } from "@/components/base/Toast";
import PermissionGate from "@/components/feature/PermissionGate";
import TouchpointModal from "@/pages/leads/components/TouchpointModal";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace, type TouchpointInput } from "@/store/WorkspaceProvider";
import type { Lead, Touchpoint } from "@/store/types";
import {
  ATTRIBUTION_DEFINITIONS,
  buildJourney,
  campaignById,
  OUTCOME_TONES,
  resolveCategory,
  TOUCHPOINT_CATEGORY_TONES,
  touchpointTypeDef,
} from "@/config/attribution";
import { formatDateTime, relativeTime } from "@/utils/format";

const REF_ICONS: Record<string, string> = {
  call: "ri-phone-line",
  email: "ri-mail-line",
  event: "ri-calendar-event-line",
  application: "ri-file-list-3-line",
  meeting: "ri-vidicon-line",
  manual: "ri-record-circle-line",
};

function refRoute(touchpoint: Touchpoint): string | null {
  if (!touchpoint.refId) return null;
  if (touchpoint.refType === "email") return "/inbox";
  if (touchpoint.refType === "application") return `/applications/${touchpoint.refId}`;
  if (touchpoint.refType === "event") return `/events/${touchpoint.refId.split(":")[0]}`;
  return null;
}

export default function JourneyPanel({ lead, touchpoints }: { lead: Lead; touchpoints?: Touchpoint[] }) {
  const { toast } = useToast();
  const { state, userName, addTouchpoint, updateTouchpoint, deleteTouchpoint } = useWorkspace();
  const { can } = usePermissions();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Touchpoint | null>(null);

  // Defensive: older records may have no touchpoints collection at all.
  const points = useMemo(() => (Array.isArray(touchpoints) ? touchpoints : []), [touchpoints]);
  const journey = useMemo(() => buildJourney(points), [points]);
  const canManage = can("attribution.manage");

  const submit = (input: TouchpointInput) => {
    if (editing) {
      updateTouchpoint(editing.id, {
        timestamp: input.timestamp,
        source: input.source,
        channel: input.channel,
        interactionType: input.interactionType,
        outcome: input.outcome,
        ownerId: input.ownerId,
        notes: input.notes,
      });
      toast({ title: "Touchpoint updated", tone: "success" });
    } else {
      addTouchpoint(input);
      toast({ title: "Touchpoint recorded", message: "The journey and reports were updated.", tone: "success" });
    }
    setModalOpen(false);
    setEditing(null);
  };

  const summary: { key: string; label: string; hint: string; point?: Touchpoint; tone: "primary" | "accent" | "secondary" | "success" }[] = [
    { key: "first", label: "First qualifying touch", hint: "Earliest qualifying interaction", point: journey.first, tone: "primary" },
    { key: "second", label: "Second qualifying touch", hint: "Second qualifying interaction", point: journey.second, tone: "secondary" },
    { key: "latest", label: "Latest qualifying touch", hint: "Most recent qualifying interaction", point: journey.latest, tone: "accent" },
    { key: "closing", label: "Closing touch", hint: "Explicitly recorded against the close", point: journey.closing, tone: "success" },
  ];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon="ri-fingerprint-line"
          iconTone="secondary"
          title="Acquisition detail"
          subtitle="Where this lead originally came from"
        />
        <CardBody className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Original source" value={lead.source} />
          <Field label="Channel" value={lead.channel} />
          <Field label="Platform" value={lead.platform} />
          <Field label="Campaign" value={lead.campaign ?? "Not recorded"} muted={!lead.campaign} />
          <Field label="Campaign ID" value={lead.campaignId ?? "Not recorded"} muted={!lead.campaignId} />
          <Field label="Acquired" value={formatDateTime(lead.acquisitionDate)} />
          <Field
            label="UTM source / medium"
            value={lead.utmSource ? `${lead.utmSource} / ${lead.utmMedium ?? "—"}` : "Not recorded"}
            muted={!lead.utmSource}
          />
          <Field label="UTM campaign" value={lead.utmCampaign ?? "Not recorded"} muted={!lead.utmCampaign} />
          <Field label="Original owner" value={userName(lead.originalOwnerId)} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summary.map((item) => (
          <div
            key={item.key}
            className="rounded-lg border border-background-200 bg-background-50 p-4"
            title={item.hint}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">
                {item.label}
              </span>
              {item.point ? (
                <Badge tone={OUTCOME_TONES[item.point.outcome as keyof typeof OUTCOME_TONES] ?? "neutral"}>
                  {item.point.outcome}
                </Badge>
              ) : (
                <Badge tone="neutral">Not recorded</Badge>
              )}
            </div>
            {item.point ? (
              <>
                <p className="mt-2 text-[13px] font-bold text-foreground-900">
                  {item.point.interactionType}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={TOUCHPOINT_CATEGORY_TONES[resolveCategory(item.point)]}>
                    {resolveCategory(item.point)}
                  </Badge>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-foreground-400">
                    {touchpointTypeDef(item.point.interactionType).engagement}
                  </span>
                </div>
                <p className="mt-1 truncate text-[12px] text-foreground-500">{item.point.source}</p>
                <p className="mt-1 text-[11px] text-foreground-400">
                  {formatDateTime(item.point.timestamp)}
                </p>
              </>
            ) : (
              <p className="mt-2 text-[13px] font-medium text-foreground-400">Not recorded</p>
            )}
          </div>
        ))}
      </div>

      {lead.closing ? (
        <Card>
          <CardHeader
            icon={lead.closing.outcome === "won" ? "ri-trophy-line" : "ri-close-circle-line"}
            iconTone={lead.closing.outcome === "won" ? "primary" : "secondary"}
            title="Closing attribution snapshot"
            subtitle="Frozen when the lead closed — later interactions never overwrite this"
          />
          <CardBody className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Outcome" value={lead.closing.outcome === "won" ? "Closed Won" : "Closed Lost"} />
            <Field label="Closing date" value={formatDateTime(lead.closing.closingDate)} />
            <Field label="Closing owner" value={userName(lead.closing.closingOwnerId)} />
            <Field label="Closing interaction" value={lead.closing.interactionType} />
            <Field label="Closing source / channel" value={`${lead.closing.source} / ${lead.closing.channel}`} />
            <Field label="Campaign" value={lead.closing.campaign ?? "Not recorded"} muted={!lead.closing.campaign} />
            {lead.closing.lossReason ? (
              <Field label="Loss reason" value={lead.closing.lossReason} />
            ) : null}
            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="Closing notes" value={lead.closing.notes || "—"} />
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          icon="ri-route-line"
          title="Touchpoint journey"
          subtitle={`${journey.ordered.length} interactions recorded · ${journey.qualifying.length} qualifying`}
          action={
            canManage ? (
              <Button
                size="sm"
                leftIcon={<i className="ri-add-line"></i>}
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                Add touchpoint
              </Button>
            ) : null
          }
        />
        {journey.ordered.length === 0 ? (
          <EmptyState
            icon="ri-route-line"
            title="No interactions recorded"
            message="No touchpoints are known for this lead yet. Attribution data is never invented — add a touchpoint to build the journey."
          />
        ) : (
          <ul className="divide-y divide-background-200">
            {journey.ordered.map((point) => {
              const def = touchpointTypeDef(point.interactionType);
              const category = resolveCategory(point);
              const isFirst = point.id === journey.first?.id;
              const isSecond = point.id === journey.second?.id;
              const isLatest = point.id === journey.latest?.id && !isFirst;
              const route = refRoute(point);
              return (
                <li key={point.id} className="flex items-start gap-3 px-5 py-3.5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background-100 text-base text-foreground-600">
                    <i className={REF_ICONS[point.refType] ?? "ri-record-circle-line"}></i>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-foreground-900">
                        {point.interactionType}
                      </span>
                      <Badge tone={TOUCHPOINT_CATEGORY_TONES[category]}>{category}</Badge>
                      {isFirst ? <Badge tone="primary">First qualifying</Badge> : null}
                      {isSecond ? <Badge tone="secondary">Second qualifying</Badge> : null}
                      {isLatest ? <Badge tone="accent">Latest qualifying</Badge> : null}
                      {point.isClosing ? <Badge tone="success">Closing touch</Badge> : null}
                      {!def.qualifying ? <Badge tone="neutral">Not qualifying</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-[12px] text-foreground-500">
                      {def.engagement} · {point.source} · {point.channel} · {userName(point.ownerId)}
                    </p>
                    {point.notes ? (
                      <p className="mt-1 text-[12px] text-foreground-600">{point.notes}</p>
                    ) : null}
                    {route ? (
                      <a
                        href={route}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-700"
                      >
                        <i className="ri-link"></i> View linked record
                      </a>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="text-[11px] text-foreground-400">{relativeTime(point.timestamp)}</span>
                    <Badge tone={OUTCOME_TONES[point.outcome as keyof typeof OUTCOME_TONES] ?? "neutral"}>
                      {point.outcome}
                    </Badge>
                    {canManage ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="Edit touchpoint"
                          onClick={() => {
                            setEditing(point);
                            setModalOpen(true);
                          }}
                          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-base text-foreground-400 hover:bg-background-100 hover:text-foreground-700"
                        >
                          <i className="ri-pencil-line"></i>
                        </button>
                        {point.isClosing ? null : (
                          <button
                            type="button"
                            aria-label="Mark as closing touch"
                            title="Mark as closing touch"
                            onClick={() => {
                              updateTouchpoint(point.id, { isClosing: true, outcome: "Converted" });
                              toast({ title: "Marked as closing touch", tone: "success" });
                            }}
                            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-base text-foreground-400 hover:bg-background-100 hover:text-green-600"
                          >
                            <i className="ri-flag-line"></i>
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Delete touchpoint"
                          onClick={() => {
                            deleteTouchpoint(point.id);
                            toast({ title: "Touchpoint removed", tone: "info" });
                          }}
                          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-base text-foreground-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <i className="ri-delete-bin-line"></i>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-background-200 px-5 py-3">
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-1.5 text-[12px] font-semibold text-foreground-600">
              <i className="ri-question-line"></i> Attribution definitions
            </summary>
            <ul className="mt-2 space-y-1.5 pl-4">
              {ATTRIBUTION_DEFINITIONS.map((line) => (
                <li key={line} className="list-disc text-[11px] leading-snug text-foreground-500">
                  {line}
                </li>
              ))}
            </ul>
          </details>
          <p className="mt-3 text-[11px] leading-snug text-foreground-500">
            Attribution method: the lead is acquired via its <strong>first qualifying touch</strong> source, while a
            conversion is attributed to the interaction explicitly recorded as the{" "}
            <strong>closing touch</strong>. Imports and audience uploads are data events and never qualify as a
            customer interaction. A touchpoint before closing is never assumed to have caused it.
            {" "}Campaign: {campaignById(lead.campaignId)?.name ?? "Not recorded"}.
          </p>
        </div>
      </Card>

      <TouchpointModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        leadId={lead.id}
        touchpoint={editing}
        defaultSource={lead.source}
        defaultOwnerId={state.users.find((u) => u.id === lead.ownerId)?.id ?? state.users[0].id}
        onSubmit={submit}
      />
    </div>
  );
}

function Field({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
      <p className={`mt-1 text-[13px] font-medium ${muted ? "text-foreground-400" : "text-foreground-900"}`}>
        {value}
      </p>
    </div>
  );
}