export interface ReferralMemberRecord {
  id: string;
  name: string;
  businessName?: string | null;
  facebookName?: string | null;
  facebookProfileUrl?: string | null;
  category: string;
  keywords: string;
  servicesOffered?: string | null;
  idealReferral?: string | null;
  negativeKeywords?: string | null;
  notes?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  aiMatchCounts?: {
    total: number;
    new: number;
    copied: number;
    introduced: number;
    dismissed: number;
    not_relevant: number;
  };
}

export interface ReferralMatchRecord {
  id: string;
  postId: string;
  referralMemberId: string;
  score: number;
  matchedKeywords?: string[] | null;
  status: string;
  referralMember: ReferralMemberRecord;
}

export interface ReferralDirectoryResponse {
  members: ReferralMemberRecord[];
  matchCounts: {
    suggested: number;
    accepted: number;
    dismissed: number;
  };
}

export interface ReferralMatchListResponse {
  items: ReferralMatchRecord[];
  total: number;
}
