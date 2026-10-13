import type { ReactNode } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import type { Capability } from "@/config/permissions";

export interface PermissionGateProps {
  capability: Capability | Capability[];
  /** "all" requires every capability, "any" requires at least one. */
  mode?: "all" | "any";
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Renders children only when the acting demo role holds the required
 * capability. This is a UI convenience only — simulated, not real security.
 */
export default function PermissionGate({
  capability,
  mode = "all",
  fallback = null,
  children,
}: PermissionGateProps) {
  const { can, canAny } = usePermissions();
  const caps = Array.isArray(capability) ? capability : [capability];
  const allowed = mode === "any" ? canAny(caps) : caps.every((cap) => can(cap));
  return <>{allowed ? children : fallback}</>;
}