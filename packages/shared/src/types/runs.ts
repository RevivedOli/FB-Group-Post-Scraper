export interface RunSummary {
  runStatus: string;
  currentGroup: string;
  groupsCompleted: number;
  totalGroups: number;
  postsInspected: number;
  newPostsSaved: number;
  scrollActions: number;
  warnings: number;
  lastRunId?: string;
  lastRunStartedAt?: string;
  lastRunCompletedAt?: string;
}

export interface RunEventRecord {
  id: string;
  scrapeRunId?: string | null;
  level: string;
  type: string;
  message: string;
  createdAt: string;
}
