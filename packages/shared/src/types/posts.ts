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
  aiAssessments?: PostAiAssessmentRecord[];
}

export interface AiMemberMatchRecord {
  id: string;
  assessmentId: string;
  referralMemberId: string;
  score: number;
  scorePercent: string;
  reason?: string | null;
  suggestedIntro?: string | null;
  status?: string;
  copiedAt?: string | null;
  introducedAt?: string | null;
  dismissedAt?: string | null;
  note?: string | null;
  referralMember?: {
    id: string;
    name: string;
    businessName?: string | null;
    facebookName?: string | null;
    facebookProfileUrl?: string | null;
    category: string;
  };
}

export interface PostAiAssessmentRecord {
  id: string;
  postId: string;
  status: string;
  model?: string | null;
  promptVersion: string;
  promptText?: string | null;
  rawResponse?: unknown;
  parsed?: unknown;
  intent?: string | null;
  isReferralOpportunity?: boolean | null;
  confidence?: number | null;
  summary?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  memberMatches?: AiMemberMatchRecord[];
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
