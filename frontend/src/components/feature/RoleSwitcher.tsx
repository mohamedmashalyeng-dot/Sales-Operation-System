import { useWorkspace } from "@/store/WorkspaceProvider";

/** The role belongs to this authenticated account and cannot be switched locally. */
export default function RoleSwitcher() {
  const { role, currentUser } = useWorkspace();
  return <div aria-label="Signed-in role" title={`${currentUser.email} - ${role.scope === "all" ? "Team records" : "Own records only"}`} className="flex h-9 items-center gap-2 rounded-md border border-accent-300 bg-accent-50 px-3 text-[13px] font-semibold text-accent-900">
    <i className="ri-shield-keyhole-line" /><span>{role.name}</span><i className="ri-lock-line text-xs" />
  </div>;
}
