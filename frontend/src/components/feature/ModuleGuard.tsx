import type { ReactNode } from "react";
import { Card } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import { roleNavVisible } from "@/config/permissions";
import { useWorkspace } from "@/store/WorkspaceProvider";

/**
 * Navigation guard for the signed-in role. The API independently enforces
 * account capabilities and record ownership.
 */
export default function ModuleGuard({ navKey, children }: { navKey: string; children: ReactNode }) {
  const { role } = useWorkspace();
  if (!roleNavVisible(role.id, navKey)) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-lock-2-line"
            title="Access restricted"
            message="Your account role does not have access to this module. Contact your workspace administrator if access is needed."
          />
        </Card>
      </div>
    );
  }
  return <>{children}</>;
}
