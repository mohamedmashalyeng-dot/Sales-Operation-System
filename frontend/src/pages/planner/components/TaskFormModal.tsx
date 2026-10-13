import { useEffect, useState } from "react";
import Button from "@/components/base/Button";
import Input from "@/components/base/Input";
import Modal from "@/components/base/Modal";
import Select from "@/components/base/Select";
import { PRIORITIES, PROGRAMMES, TASK_SOURCES } from "@/config/crm";
import { useWorkspace, type TaskInput } from "@/store/WorkspaceProvider";
import type { Priority, Task, TaskSource } from "@/store/types";
import { fromInputDateTime, toInputDateTime } from "@/utils/crm";

interface TaskFormModalProps {
  open: boolean;
  onClose: () => void;
  task?: Task | null;
  defaults?: Partial<TaskInput>;
  onSubmit: (input: TaskInput) => void;
}

interface FormState {
  title: string;
  description: string;
  ownerId: string;
  priority: Priority;
  dueAt: string;
  source: TaskSource;
  relatedLeadId: string;
  relatedThreadId: string;
  relatedEventId: string;
  programme: string;
  notes: string;
}

export default function TaskFormModal({ open, onClose, task, defaults, onSubmit }: TaskFormModalProps) {
  const { state, currentUserId } = useWorkspace();
  const [form, setForm] = useState<FormState>({
    title: "",
    description: "",
    ownerId: currentUserId,
    priority: "Medium",
    dueAt: "",
    source: "Manual",
    relatedLeadId: "",
    relatedThreadId: "",
    relatedEventId: "",
    programme: "",
    notes: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (task) {
      setForm({
        title: task.title,
        description: task.description,
        ownerId: task.ownerId,
        priority: task.priority,
        dueAt: toInputDateTime(task.dueAt),
        source: task.source,
        relatedLeadId: task.relatedLeadId ?? "",
        relatedThreadId: task.relatedThreadId ?? "",
        relatedEventId: task.relatedEventId ?? "",
        programme: task.programme ?? "",
        notes: task.notes,
      });
    } else {
      setForm({
        title: defaults?.title ?? "",
        description: defaults?.description ?? "",
        ownerId: defaults?.ownerId ?? currentUserId,
        priority: defaults?.priority ?? "Medium",
        dueAt: toInputDateTime(defaults?.dueAt ?? new Date().toISOString()),
        source: defaults?.source ?? "Manual",
        relatedLeadId: defaults?.relatedLeadId ?? "",
        relatedThreadId: defaults?.relatedThreadId ?? "",
        relatedEventId: defaults?.relatedEventId ?? "",
        programme: defaults?.programme ?? "",
        notes: defaults?.notes ?? "",
      });
    }
    setErrors({});
  }, [open, task, defaults, currentUserId]);

  const set = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSubmit = () => {
    if (!form.title.trim()) {
      setErrors({ title: "Task title is required." });
      return;
    }
    onSubmit({
      title: form.title.trim(),
      description: form.description.trim(),
      ownerId: form.ownerId,
      priority: form.priority,
      dueAt: fromInputDateTime(form.dueAt) || new Date().toISOString(),
      source: form.source,
      relatedLeadId: form.relatedLeadId || undefined,
      relatedThreadId: form.relatedThreadId || undefined,
      relatedEventId: form.relatedEventId || undefined,
      programme: form.programme || undefined,
      notes: form.notes,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={task ? "Edit task" : "New task"}
      description="Tasks feed the Planner and the Today dashboard."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button leftIcon={<i className="ri-save-line"></i>} onClick={handleSubmit}>
            {task ? "Save changes" : "Create task"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Input
            label="Task title"
            value={form.title}
            error={errors.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="e.g. Call back Daniel Mercer"
          />
        </div>
        <Select
          label="Owner"
          value={form.ownerId}
          onChange={(v) => set({ ownerId: v })}
          options={state.users.map((u) => ({ value: u.id, label: u.name }))}
        />
        <Select
          label="Priority"
          value={form.priority}
          onChange={(v) => set({ priority: v as Priority })}
          options={PRIORITIES.map((p) => ({ value: p, label: p }))}
        />
        <Input
          label="Due date &amp; time"
          type="datetime-local"
          value={form.dueAt}
          onChange={(e) => set({ dueAt: e.target.value })}
        />
        <Select
          label="Source"
          value={form.source}
          onChange={(v) => set({ source: v as TaskSource })}
          options={TASK_SOURCES.map((s) => ({ value: s, label: s }))}
        />
        <Select
          label="Related lead"
          value={form.relatedLeadId}
          onChange={(v) => set({ relatedLeadId: v })}
          placeholder="None"
          options={[
            { value: "", label: "None" },
            ...state.leads.map((l) => ({ value: l.id, label: `${l.name} (${l.id})` })),
          ]}
        />
        <Select
          label="Related email"
          value={form.relatedThreadId}
          onChange={(v) => set({ relatedThreadId: v })}
          placeholder="None"
          options={[
            { value: "", label: "None" },
            ...state.threads.slice(0, 12).map((t) => ({ value: t.id, label: t.subject.slice(0, 40) })),
          ]}
        />
        <Select
          label="Programme"
          value={form.programme}
          onChange={(v) => set({ programme: v })}
          placeholder="None"
          options={[{ value: "", label: "None" }, ...PROGRAMMES.map((p) => ({ value: p, label: p }))]}
        />
        <Input
          label="Notes"
          value={form.notes}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder="Optional context"
        />
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Description
          </label>
          <textarea
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            rows={3}
            maxLength={500}
            placeholder="What needs to happen?"
            className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
      </div>
    </Modal>
  );
}