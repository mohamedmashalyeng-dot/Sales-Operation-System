import AttentionQueue from "@/pages/today/components/AttentionQueue";
import InboxResponseTracking from "@/pages/today/components/InboxResponseTracking";
import MyWorkToday from "@/pages/today/components/MyWorkToday";
import RecentActivity from "@/pages/today/components/RecentActivity";
import TeamOverview from "@/pages/today/components/TeamOverview";
import { DEFAULT_FILTERS } from "@/pages/today/components/TodayFilters";
import { useTodayData } from "@/pages/today/useTodayData";
import { useWorkspace } from "@/store/WorkspaceProvider";

export default function Today() {
  const { completeTask } = useWorkspace();
  const data = useTodayData(DEFAULT_FILTERS);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-3 py-4 md:px-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <MyWorkToday
          tasks={data.tasks}
          appointments={data.appointments}
          onComplete={(id) => completeTask(id)}
        />
        <InboxResponseTracking data={data.inboxTracking} />
        <RecentActivity items={data.activity} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <AttentionQueue items={data.attention} />
        <TeamOverview rows={data.team} />
      </div>
    </div>
  );
}
