import { useEffect, useState } from "react";
import Button from "@/components/base/Button";
import Modal from "@/components/base/Modal";
import Select from "@/components/base/Select";
import {
  ACQUISITION_PROVIDERS,
  CAMPAIGN_TYPES,
  COMMUNICATION_CHANNELS,
  CRM_SYSTEMS,
  MARKETING_PLATFORMS,
  type CampaignType,
} from "@/config/marketing";
import type { CampaignInput } from "@/store/actions/marketing";

const PLATFORM_OPTIONS = MARKETING_PLATFORMS.map((p) => ({ value: p.label, label: p.label, icon: p.icon }));
const CRM_OPTIONS = CRM_SYSTEMS.map((c) => ({ value: c.label, label: c.label, icon: c.icon }));
const PROVIDER_OPTIONS = ACQUISITION_PROVIDERS.map((p) => ({ value: p.label, label: p.label, icon: p.icon }));
const CHANNEL_OPTIONS = COMMUNICATION_CHANNELS.map((c) => ({ value: c, label: c }));

export default function CampaignFormModal({
  open,
  onClose,
  onSubmit,
  events,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CampaignInput) => void;
  events: { id: string; name: string }[];
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<CampaignType>("Email invitation");
  const [platform, setPlatform] = useState("Eventbrite");
  const [channel, setChannel] = useState("Email");
  const [crmSystem, setCrmSystem] = useState("Zoho CRM");
  const [provider, setProvider] = useState("Apollo.io");
  const [eventId, setEventId] = useState(events[0]?.id ?? "none");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setType("Email invitation");
      setPlatform("Eventbrite");
      setChannel("Email");
      setCrmSystem("Zoho CRM");
      setProvider("Apollo.io");
      setEventId(events[0]?.id ?? "none");
      setSubject("");
      setBody("");
      setError("");
    }
  }, [open, events]);

  const submit = () => {
    if (!name.trim()) {
      setError("Give the campaign a name.");
      return;
    }
    if (!subject.trim()) {
      setError("The invitation needs a subject line.");
      return;
    }
    onSubmit({
      name: name.trim(),
      type,
      platform,
      channel,
      crmSystem,
      acquisitionProvider: provider,
      eventId: eventId === "none" ? undefined : eventId,
      subject: subject.trim(),
      body: body.trim(),
      ownerId: "",
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Create event campaign"
      description="Track the audience, the platform, the CRM and the acquisition provider as separate layers."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button leftIcon={<i className="ri-megaphone-line"></i>} onClick={submit}>
            Create campaign
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Campaign name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Open Evening — Email Invitation"
            className="h-9 w-full rounded-md border border-background-300 bg-background-50 px-3 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Campaign type"
            value={type}
            onChange={(v) => setType(v as CampaignType)}
            options={CAMPAIGN_TYPES.map((t) => ({ value: t, label: t }))}
          />
          <Select
            label="Linked event"
            value={eventId}
            onChange={setEventId}
            options={[{ value: "none", label: "No linked event" }, ...events.map((e) => ({ value: e.id, label: e.name }))]}
          />
          <Select label="Marketing platform" value={platform} onChange={setPlatform} options={PLATFORM_OPTIONS} />
          <Select label="Communication channel" value={channel} onChange={setChannel} options={CHANNEL_OPTIONS} />
          <Select label="CRM system" value={crmSystem} onChange={setCrmSystem} options={CRM_OPTIONS} />
          <Select label="Acquisition provider" value={provider} onChange={setProvider} options={PROVIDER_OPTIONS} />
        </div>

        <p className="flex items-start gap-1.5 rounded-md bg-secondary-100/70 px-3 py-2 text-[11px] font-medium text-secondary-900">
          <i className="ri-information-line mt-0.5"></i>
          The acquisition provider stays the ORIGINAL source. Importing contacts and sending invitations never
          overwrites where a contact originally came from.
        </p>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Invitation subject
          </label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="You're invited: Kent Business College Open Evening"
            className="h-9 w-full rounded-md border border-background-300 bg-background-50 px-3 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Invitation body
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="Compose the fictional invitation…"
            className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
          <p className="mt-1 text-[11px] text-foreground-400">
            {body.length} characters · This is a fictional demonstration email.
          </p>
        </div>

        {error ? (
          <p className="flex items-center gap-1.5 rounded-md bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">
            <i className="ri-error-warning-line"></i>
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
