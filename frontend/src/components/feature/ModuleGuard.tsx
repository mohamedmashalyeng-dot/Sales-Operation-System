import type { ReactNode } from "react";
import { Card } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import { roleNavVisible } from "@/config/permissions";
import { useWorkspace } from "@/store/WorkspaceProvider";

/**
 * Simulated route guard. Hides a module's pages from any workspace role whose
 * navigation does not include the module key, so restricted pages cannot be
 * reached by direct URL. Frontend-only — not real security.
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
            message="Your workspace role does not have access to this module. Switch roles from the profile menu to explore it."
          />
        </Card>
      </div>
    );
  }
  return <>{children}</>;
}
