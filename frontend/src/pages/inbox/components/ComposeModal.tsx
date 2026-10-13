import { useEffect, useState } from "react";
import Button from "@/components/base/Button";
import Input from "@/components/base/Input";
import Modal from "@/components/base/Modal";
import LabelMultiSelect from "@/pages/inbox/components/LabelMultiSelect";
import { useWorkspace, type ComposeInput } from "@/store/WorkspaceProvider";

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
  onSent?: (input: ComposeInput) => void;
}

export default function ComposeModal({ open, onClose, onSent }: ComposeModalProps) {
  const { currentUserId } = useWorkspace();
  const [toName, setToName] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setToName("");
    setToEmail("");
    setSubject("");
    setBody("");
    setLabelIds([]);
    setErrors({});
  }, [open]);

  const toggleLabel = (id: string) =>
    setLabelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleSend = () => {
    const next: Record<string, string> = {};
    if (!toEmail.trim()) next.toEmail = "Recipient email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) next.toEmail = "Enter a valid email.";
    if (!subject.trim()) next.subject = "Subject is required.";
    if (!body.trim()) next.body = "Write a message before sending.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    onSent?.({
      toName: toName.trim() || toEmail.trim(),
      toEmail: toEmail.trim(),
      subject: subject.trim(),
      body: body.trim(),
      labelIds,
      ownerId: currentUserId,
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New message"
      description="Simulated compose — emails are recorded in the workspace but are never actually delivered."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button leftIcon={<i className="ri-send-plane-line"></i>} onClick={handleSend}>
            Send email
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Recipient name" value={toName} onChange={(e) => setToName(e.target.value)} placeholder="e.g. Elaine Foster" />
          <Input
            label="Recipient email"
            type="email"
            value={toEmail}
            error={errors.toEmail}
            onChange={(e) => setToEmail(e.target.value)}
            placeholder="name@example.com"
          />
        </div>
        <Input
          label="Subject"
          value={subject}
          error={errors.subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject line"
        />
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Message
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            maxLength={500}
            placeholder="Write your message…"
            className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
          <p className="mt-1 text-right text-[11px] text-foreground-400">{body.length}/500</p>
          {errors.body ? <p className="text-xs font-medium text-red-600">{errors.body}</p> : null}
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Apply labels
          </p>
          <LabelMultiSelect selected={labelIds} onToggle={toggleLabel} />
        </div>
      </div>
    </Modal>
  );
}