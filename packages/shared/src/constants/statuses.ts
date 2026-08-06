export const baselineStatuses = ['never_scanned', 'baseline_in_progress', 'baseline_completed', 'baseline_failed', 'needs_rebaseline'] as const;
export const reviewStatuses = ['new', 'requires_review', 'useful', 'ignored'] as const;
export const analysisStatuses = ['not_analysed', 'queued', 'analysing', 'analysed', 'skipped', 'failed', 'ignored'] as const;
