import { useMemo } from "react";
import { useWorkspace } from "@/store/WorkspaceProvider";
import {
  roleById,
  roleCan,
  type Capability,
  type DataScope,
  type RoleDefinition,
} from "@/config/permissions";

export interface Permissions {
  role: RoleDefinition;
  scope: DataScope;
  /** True when the acting user may see every record in the workspace. */
  seesAll: boolean;
  currentUserId: string;
  can: (capability: Capability) => boolean;
  canAny: (capabilities: Capability[]) => boolean;
  /** Under an "own" scope, only the acting user's records are visible. */
  canSeeOwner: (ownerId: string | null | undefined) => boolean;
  /** Convenience: list of user ids whose records this role may see. Empty means all. */
  visibleOwnerIds: string[];
}

export function usePermissions(): Permissions {
  const { roleId, currentUserId } = useWorkspace();

  return useMemo<Permissions>(() => {
    const role = roleById(roleId);
    const seesAll = role.scope === "all";
    const can = (capability: Capability) => roleCan(roleId, capability);
    return {
      role,
      scope: role.scope,
      seesAll,
      currentUserId,
      can,
      canAny: (capabilities: Capability[]) => capabilities.some((cap) => can(cap)),
      canSeeOwner: (ownerId: string | null | undefined) => {
        if (seesAll) return true;
        return ownerId === currentUserId;
      },
      visibleOwnerIds: seesAll ? [] : [currentUserId],
    };
  }, [roleId, currentUserId]);
}