export interface RunSummary {
  runStatus: string;
  currentGroup: string;
  groupsCompleted: number;
  totalGroups: number;
  remainingGroups?: number;
  postsInspected: number;
  newPostsSaved: number;
  scrollActions: number;
  warnings: number;
  lastRunId?: string;
  lastRunStartedAt?: string;
  lastRunCompletedAt?: string;
}

export interface RunStartOptions {
  enabledCount: number;
  remainingCount: number;
  remainingGroups: Array<{ id: string; friendlyName: string }>;
  lastAllRunStatus?: string | null;
  lastAllRunGroupsCompleted?: number;
  lastAllRunStartedAt?: string | null;
}

export interface RunEventRecord {
  id: string;
  scrapeRunId?: string | null;
  level: string;
  type: string;
  message: string;
  createdAt: string;
}
