export interface PostRecord {
  id: string;
  groupId: string;
  canonicalPostUrl: string;
  facebookPostId?: string | null;
  authorName?: string | null;
  latestCapturedText?: string | null;
  originalTimestampLabel?: string | null;
  originalPostedAt?: string | null;
  firstDiscoveredAt: string;
  lastObservedAt: string;
  hasImages: boolean;
  imageCount: number;
  analysisStatus: string;
  reviewStatus: string;
  monitoringStatus: string;
  extractionStrategy?: string | null;
  extractionConfidence?: number | null;
}

export interface PostListResponse {
  items: PostRecord[];
  total: number;
}
