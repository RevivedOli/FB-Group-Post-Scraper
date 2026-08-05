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

export interface PostDetailResponse {
  post: PostRecord & Record<string, unknown>;
}

export interface PostListResponse {
  items: PostRecord[];
  total: number;
  counts?: {
    all: number;
    new: number;
    requires_review: number;
    useful: number;
    ignored: number;
  };
}
