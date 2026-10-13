import { useMemo, useState } from "react";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import EmptyState from "@/components/base/EmptyState";
import { useToast } from "@/components/base/Toast";
import {
  DEMO_ZOHO_AUDIENCE_CSV,
  parseAudienceCsv,
  type AudienceRow,
} from "@/config/marketing";
import { buildAudience } from "@/store/actions/marketing";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { EventCampaign } from "@/store/types";

export default function AudienceImportPanel({
  campaign,
  canManage,
}: {
  campaign: EventCampaign;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const { state, importCampaignAudience } = useWorkspace();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string>("zoho-export.csv");

  const parsed = useMemo(() => (csv.trim() ? parseAudienceCsv(csv) : { rows: [] as AudienceRow[] }), [csv]);

  const preview = useMemo(
    () => (parsed.rows.length ? buildAudience(parsed.rows, state.leads, campaign.recipients) : []),
    [parsed.rows, state.leads, campaign.recipients],
  );

  const valid = preview.filter((r) => r.valid && !r.duplicate).length;
  const invalid = preview.filter((r) => !r.valid).length;
  const duplicates = preview.filter((r) => r.duplicate).length;
  const matched = preview.filter((r) => r.matched).length;
  const newContacts = preview.filter((r) => !r.matched).length;

  const loadSample = () => {
    setCsv(DEMO_ZOHO_AUDIENCE_CSV);
    setFileName("zoho-export-open-evening.csv");
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result ?? ""));
      setFileName(file.name);
    };
    reader.readAsText(file);
  };

  const doImport = () => {
    if (!canManage) return;
    if (!parsed.rows.length) return;
    const result = importCampaignAudience(campaign.id, parsed.rows, fileName);
    toast({
      title: `${result.added} contacts imported`,
      message: `${result.valid} valid · ${result.duplicates} duplicates detected`,
      tone: "success",
    });
    setCsv("");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-background-200 bg-background-100/60 p-3">
        <p className="text-[12px] font-semibold text-foreground-800">
          Import an email audience from a simulated Zoho CRM export
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">
          Export the audience from Zoho CRM and upload it to Eventbrite. Valid addresses are matched to the
          shared dataset by normalised email — the same person in Zoho and Eventbrite is never duplicated.
        </p>
      </div>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-background-300 bg-background-50 px-3 py-1.5 text-[13px] font-semibold text-foreground-700 hover:bg-background-100">
            <i className="ri-upload-2-line"></i>
            Choose CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          <Button variant="outline" size="sm" leftIcon={<i className="ri-file-excel-2-line"></i>} onClick={loadSample}>
            Use sample Zoho export
          </Button>
          {csv.trim() ? (
            <Button variant="ghost" size="sm" onClick={() => setCsv("")}>
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}

      {canManage ? (
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={5}
          placeholder="name,email,phone…"
          className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 font-mono text-[12px] text-foreground-800 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
        />
      ) : null}

      {parsed.error ? (
        <p className="flex items-center gap-1.5 rounded-md bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">
          <i className="ri-error-warning-line"></i>
          {parsed.error}
        </p>
      ) : null}

      {preview.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <Stat label="Rows" value={preview.length} tone="secondary" />
            <Stat label="Valid" value={valid} tone="success" />
            <Stat label="Invalid" value={invalid} tone="danger" />
            <Stat label="Duplicates" value={duplicates} tone="warning" />
            <Stat label="Matched leads" value={matched} tone="primary" />
          </div>

          <div className="overflow-hidden rounded-lg border border-background-200">
            <table className="w-full text-left">
              <thead className="bg-background-100">
                <tr className="text-[11px] uppercase tracking-wide text-foreground-500">
                  <th className="px-3 py-2 font-semibold">Contact</th>
                  <th className="px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Relationship</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200">
                {preview.map((r) => (
                  <tr key={r.id} className="text-[12.5px]">
                    <td className="px-3 py-2 font-medium text-foreground-900">{r.name}</td>
                    <td className="px-3 py-2 text-foreground-600">{r.email || "—"}</td>
                    <td className="px-3 py-2">
                      {!r.valid ? (
                        <Badge tone="danger">Invalid email</Badge>
                      ) : r.duplicate ? (
                        <Badge tone="warning">Duplicate</Badge>
                      ) : (
                        <Badge tone="success">Ready</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.matched ? (
                        <Badge tone="primary" icon="ri-link">
                          Existing contact
                        </Badge>
                      ) : (
                        <Badge tone="neutral">New contact</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-foreground-500">
              {valid} ready · {newContacts} new contacts will be created as contacts only (no lead is invented).
            </p>
            {canManage ? (
              <Button leftIcon={<i className="ri-download-2-line"></i>} onClick={doImport} disabled={valid === 0}>
                Import {valid} contacts
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <EmptyState
          icon="ri-file-list-3-line"
          title="No audience loaded"
          message="Choose a CSV file or paste the exported audience to preview it before importing."
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "primary" | "accent" | "secondary" | "success" | "warning" | "danger";
}) {
  const tones: Record<string, string> = {
    primary: "text-primary-700",
    accent: "text-accent-900",
    secondary: "text-secondary-900",
    success: "text-green-700",
    warning: "text-amber-700",
    danger: "text-red-700",
  };
  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-3">
      <p className={`font-heading text-xl font-bold leading-none ${tones[tone]}`}>{value}</p>
      <p className="mt-1 text-[11px] font-medium text-foreground-500">{label}</p>
    </div>
  );
}