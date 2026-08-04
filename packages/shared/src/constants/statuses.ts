export const baselineStatuses = ['never_scanned', 'baseline_in_progress', 'baseline_completed', 'baseline_failed', 'needs_rebaseline'] as const;
export const reviewStatuses = ['new', 'requires_review', 'ignored'] as const;
export const analysisStatuses = ['not_analysed', 'queued', 'analysing', 'analysed', 'failed', 'ignored'] as const;
