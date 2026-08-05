export interface ReferralMemberRecord {
  id: string;
  name: string;
  businessName?: string | null;
  category: string;
  keywords: string;
  notes?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
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
