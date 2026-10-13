import { useEffect, useState } from "react";
import Button from "@/components/base/Button";
import Input from "@/components/base/Input";
import Modal from "@/components/base/Modal";
import Select from "@/components/base/Select";
import { INTAKES, LEAD_SOURCES, LEAD_STAGES, PRIORITIES, PROGRAMMES } from "@/config/crm";
import { useWorkspace, type LeadInput } from "@/store/WorkspaceProvider";
import type { Lead, LeadStage, Priority } from "@/store/types";
import { fromInputDateTime, toInputDateTime } from "@/utils/crm";

interface LeadFormModalProps {
  open: boolean;
  onClose: () => void;
  lead?: Lead | null;
  onSubmit: (input: LeadInput) => void;
}

interface FormState {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  programme: string;
  intake: string;
  source: string;
  ownerId: string;
  stage: LeadStage;
  priority: Priority;
  value: string;
  nextAction: string;
  nextActionAt: string;
  tags: string;
}

function emptyForm(ownerId: string): FormState {
  return {
    name: "",
    contactName: "",
    email: "",
    phone: "",
    programme: PROGRAMMES[0],
    intake: INTAKES[2],
    source: LEAD_SOURCES[0],
    ownerId,
    stage: "New",
    priority: "Medium",
    value: "0",
    nextAction: "",
    nextActionAt: "",
    tags: "",
  };
}

export default function LeadFormModal({ open, onClose, lead, onSubmit }: LeadFormModalProps) {
  const { state, currentUserId } = useWorkspace();
  const [form, setForm] = useState<FormState>(emptyForm(currentUserId));
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (lead) {
      setForm({
        name: lead.name,
        contactName: lead.contactName,
        email: lead.email,
        phone: lead.phone,
        programme: lead.programme,
        intake: lead.intake,
        source: lead.source,
        ownerId: lead.ownerId,
        stage: lead.stage,
        priority: lead.priority,
        value: String(lead.value),
        nextAction: lead.nextAction,
        nextActionAt: toInputDateTime(lead.nextActionAt),
        tags: lead.tags.join(", "),
      });
    } else {
      setForm(emptyForm(currentUserId));
    }
    setErrors({});
  }, [open, lead, currentUserId]);

  const set = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Lead name is required.";
    if (!form.email.trim()) next.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = "Enter a valid email.";
    if (!form.programme) next.programme = "Choose a programme.";
    if (!form.ownerId) next.ownerId = "Assign an owner.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    onSubmit({
      name: form.name.trim(),
      contactName: form.contactName.trim() || form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      programme: form.programme,
      intake: form.intake,
      source: form.source,
      ownerId: form.ownerId,
      stage: form.stage,
      priority: form.priority,
      value: Number(form.value) || 0,
      nextAction: form.nextAction.trim() || "First contact",
      nextActionAt: fromInputDateTime(form.nextActionAt) || new Date().toISOString(),
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
  };

  const ownerOptions = state.users.map((u) => ({ value: u.id, label: u.name }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={lead ? "Edit lead" : "New lead"}
      description={
        lead ? "Update the CRM record. Changes are saved to the demonstration dataset." : "Create a lead in the demonstration dataset."
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button leftIcon={<i className="ri-save-line"></i>} onClick={handleSubmit}>
            {lead ? "Save changes" : "Create lead"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Lead name"
          value={form.name}
          error={errors.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="e.g. Daniel Mercer"
        />
        <Input
          label="Contact name"
          value={form.contactName}
          onChange={(e) => set({ contactName: e.target.value })}
          placeholder="e.g. Elaine Foster"
        />
        <Input
          label="Email"
          type="email"
          value={form.email}
          error={errors.email}
          onChange={(e) => set({ email: e.target.value })}
          placeholder="name@example.com"
        />
        <Input
          label="Phone"
          value={form.phone}
          onChange={(e) => set({ phone: e.target.value })}
          placeholder="+44 7700 900000"
        />
        <Select
          label="Programme"
          value={form.programme}
          onChange={(v) => set({ programme: v })}
          options={PROGRAMMES.map((p) => ({ value: p, label: p }))}
        />
        <Select
          label="Intake"
          value={form.intake}
          onChange={(v) => set({ intake: v })}
          options={INTAKES.map((i) => ({ value: i, label: i }))}
        />
        <Select
          label="Source"
          value={form.source}
          onChange={(v) => set({ source: v })}
          options={LEAD_SOURCES.map((s) => ({ value: s, label: s }))}
        />
        <Select
          label="Owner"
          value={form.ownerId}
          onChange={(v) => set({ ownerId: v })}
          options={ownerOptions}
          placeholder="Assign owner"
        />
        <Select
          label="Stage"
          value={form.stage}
          onChange={(v) => set({ stage: v as LeadStage })}
          options={LEAD_STAGES.map((s) => ({ value: s, label: s }))}
        />
        <Select
          label="Priority"
          value={form.priority}
          onChange={(v) => set({ priority: v as Priority })}
          options={PRIORITIES.map((p) => ({ value: p, label: p }))}
        />
        <Input
          label="Estimated value (£)"
          type="number"
          value={form.value}
          onChange={(e) => set({ value: e.target.value })}
        />
        <Input
          label="Next action"
          value={form.nextAction}
          onChange={(e) => set({ nextAction: e.target.value })}
          placeholder="e.g. Call back about funding"
        />
        <Input
          label="Next action due"
          type="datetime-local"
          value={form.nextActionAt}
          onChange={(e) => set({ nextActionAt: e.target.value })}
        />
        <Input
          label="Tags (comma separated)"
          value={form.tags}
          onChange={(e) => set({ tags: e.target.value })}
          placeholder="CMI, Funding enquiry"
        />
      </div>
      {errors.ownerId || errors.programme ? (
        <p className="mt-3 text-xs font-medium text-red-600">{errors.ownerId || errors.programme}</p>
      ) : null}
    </Modal>
  );
}