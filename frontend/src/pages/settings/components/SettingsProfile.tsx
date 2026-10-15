import { useState, type FormEvent } from "react";
import Avatar from "@/components/base/Avatar";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import Input from "@/components/base/Input";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import { useWorkspace } from "@/store/WorkspaceProvider";

export default function SettingsProfile() {
  const { currentUser, role } = useWorkspace();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const change = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (password !== confirmation) { setError("New passwords do not match."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/password", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15000), body: JSON.stringify({ current_password: current, new_password: password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || result.message || "Unable to change password.");
      try {
        localStorage.removeItem("kbc-workspace-v1"); localStorage.removeItem("kbc-workspace-backup-v1");
        localStorage.setItem("kbc-auth-revision", crypto.randomUUID());
      } catch { /* The server has still revoked this account's sessions. */ }
      window.location.replace("/today");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to change password."); }
    finally { setSaving(false); }
  };
  return <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
    <Card><CardHeader icon="ri-user-line" title="Your account" subtitle="Signed-in workspace identity" /><CardBody>
      <div className="flex items-center gap-3"><Avatar name={currentUser.name} size="lg" /><div className="min-w-0"><p className="truncate font-bold">{currentUser.name}</p><p className="truncate text-xs text-foreground-500">{currentUser.email}</p></div></div>
      <dl className="mt-5 space-y-4 text-sm"><div className="flex justify-between"><dt>Role</dt><dd><Badge tone={role.tone}>{role.name}</Badge></dd></div><div className="flex justify-between"><dt>Data scope</dt><dd>{role.scope === "all" ? "Team records" : "Own records only"}</dd></div></dl>
      <p className="mt-5 rounded-md bg-background-100 p-3 text-xs text-foreground-600"><i className="ri-lock-line mr-1" />Your role is assigned by the workspace administrator. Sign out to use another account.</p>
    </CardBody></Card>
    <Card className="xl:col-span-2"><CardHeader icon="ri-key-2-line" title="Change your password" subtitle="Changing your password signs out your active sessions." /><CardBody>
      {role.id === "admin" ? <p className="text-sm text-foreground-600">The developer account password is managed in the server configuration.</p> : <form onSubmit={change} className="max-w-md space-y-4">
        <Input label="Current password" id="current-password" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required />
        <Input label="New password" id="new-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required />
        <Input label="Confirm new password" id="confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirmation} onChange={e => setConfirmation(e.target.value)} required />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <Button type="submit" loading={saving} disabled={saving}>{saving ? "Saving..." : "Change password & sign out"}</Button>
      </form>}
    </CardBody></Card>
  </div>;
}
