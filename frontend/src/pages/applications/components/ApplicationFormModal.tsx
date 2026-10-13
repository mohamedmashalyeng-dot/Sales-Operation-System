import { useEffect, useState } from "react";
import Button from "@/components/base/Button";
import Input from "@/components/base/Input";
import Modal from "@/components/base/Modal";
import Select from "@/components/base/Select";
import { APPLICATION_STATUSES, INTAKES, PROGRAMMES } from "@/config/crm";
import { useWorkspace, type ApplicationInput } from "@/store/WorkspaceProvider";
import type { Application, ApplicationStatus } from "@/store/types";

interface ApplicationFormModalProps {
  open: boolean;
  application: Application | null;
  onClose: () => void;
  onSubmit: (input: ApplicationInput) => void;
}

interface FormState {
  applicantName: string;
  email: string;
  phone: string;
  programme: string;
  intake: string;
  status: ApplicationStatus;
  ownerId: string;
  leadId: string;
}

export default function ApplicationFormModal({
  open,
  application,
  onClose,
  onSubmit,
}: ApplicationFormModalProps) {
  const { state, currentUserId } = useWorkspace();
  const [form, setForm] = useState<FormState>({
    applicantName: "",
    email: "",
    phone: "",
    programme: PROGRAMMES[0],
    intake: INTAKES[0],
    status: "Submitted",
    ownerId: currentUserId,
    leadId: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (application) {
      setForm({
        applicantName: application.applicantName,
        email: application.email,
        phone: application.phone,
        programme: application.programme,
        intake: application.intake,
        status: application.status,
        ownerId: application.ownerId,
        leadId: application.leadId ?? "",
      });
    } else {
      setForm({
        applicantName: "",
        email: "",
        phone: "",
        programme: PROGRAMMES[0],
        intake: INTAKES[0],
        status: "Submitted",
        ownerId: currentUserId,
        leadId: "",
      });
    }
    setErrors({});
  }, [open, application, currentUserId]);

  const set = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const validate = () => {
    const next: Record<string, string> = {};
    if (form.applicantName.trim().length < 2) next.applicantName = "Applicant name is required.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim()))
      next.email = "Enter a valid email address.";
    if (!form.programme) next.programme = "Choose a programme.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    onSubmit({
      applicantName: form.applicantName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      programme: form.programme,
      intake: form.intake,
      status: form.status,
      ownerId: form.ownerId,
      leadId: form.leadId || undefined,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={application ? "Edit application" : "New application"}
      description={
        application
          ? `Update the details for ${application.applicantName}.`
          : "Create an application and link it to an existing lead."
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button leftIcon={<i className="ri-save-line"></i>} onClick={handleSubmit}>
            {application ? "Save changes" : "Create application"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Applicant name"
          name="applicantName"
          value={form.applicantName}
          onChange={(e) => set({ applicantName: e.target.value })}
          error={errors.applicantName}
          placeholder="e.g. Priya Raman"
        />
        <Input
          label="Email"
          name="email"
          type="email"
          value={form.email}
          onChange={(e) => set({ email: e.target.value })}
          error={errors.email}
          placeholder="name@example.com"
        />
        <Input
          label="Phone"
          name="phone"
          value={form.phone}
          onChange={(e) => set({ phone: e.target.value })}
          placeholder="+44 7700 900000"
        />
        <Select
          label="Status"
          value={form.status}
          onChange={(v) => set({ status: v as ApplicationStatus })}
          options={APPLICATION_STATUSES.map((s) => ({ value: s, label: s }))}
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
          label="Enrolment officer"
          value={form.ownerId}
          onChange={(v) => set({ ownerId: v })}
          options={state.users.map((u) => ({ value: u.id, label: u.name }))}
        />
        <Select
          label="Related lead (optional)"
          value={form.leadId}
          onChange={(v) => set({ leadId: v })}
          options={[
            { value: "", label: "No linked lead" },
            ...state.leads.map((l) => ({ value: l.id, label: `${l.name} — ${l.programme}` })),
          ]}
        />
      </div>
    </Modal>
  );
}