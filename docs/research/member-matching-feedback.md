# Human corrections for referral matching

In Referral Directory → Review Matches, Dismiss opens an explanation dialog. Learning is enabled by default; an explanation of 5–1,000 characters is required to save a matching correction. The user may switch learning off to hide a one-off match without creating a lesson. Previously dismissed matches can be selected with the Dismissed status filter and explained retroactively.

Corrections are member-scoped, append-only, versioned JSON rows in the existing Setting table (`referral.member-feedback.v1.*`). No member service, keyword, negative-keyword or note fields are overwritten. Each row includes the human reason, rejected-post excerpt and URL, original AI reason, member category/service snapshot, capture hash, date and active flag. A key incorporating member/match identity, reason and captured-post hash makes retries idempotent while preserving distinct corrections. Member Profile → Matching corrections shows saved examples and allows enabling/disabling them without erasing history.

The status change, correction append and cancellation of pending/retry Telegram deliveries for that post/member are one SQLite transaction. Already sent alerts are retained. Writing a correction does not call an AI provider or rerun historical assessments.

New assessments read current feedback alongside active member profiles. The actual persisted provider input includes up to four relevant active examples per member, ranked by textual overlap with recency as a tie-breaker. All corrections remain stored and reviewable. The prompt instructs the model to apply service-specific corrections contextually rather than exclude a member wholesale. This is inference context, not a guarantee of perfect classifications. The unchanged rejected source post/member pair is explicitly filtered from recommendations while its correction remains active; edited posts are reconsidered.

Verification:
- Both frontend TypeScript/production build and local API TypeScript build passed.
- 73 locally available API tests passed, including 7 real SQLite correction tests and 6 prompt/queue tests. Seven older regression files remain unavailable in iCloud and were not included in this local run.
- Tests cover validation, atomic persistence, profile preservation, retry deduplication, multiple corrections, dismiss-only behavior, active/disabled examples, member scoping, unchanged/edited post handling, unsent-alert cancellation and rollback on failure.
- Browser verified the dialog on an existing dismissed match, disabled save with an empty reason, and the correction-history tab. No live reviewer reason or dismissal was submitted during verification.
- Live endpoints healthy; saved-post count remained 3,278 and next recurring collection remained 20:15:54 on 5 November.

Runtime: UI serves its rebuilt bundle from Development. The API was built with fresh Development dependencies; compiled modules were installed at the original API runtime path to retain the existing Python collector paths. A consistent private app-database backup was created before the API reload. No database-schema migration was required. Source changes are mirrored into Development; the overall GitHub push and repository migration are still separate pending work.

## Concise correction summaries
Learned dismissals now retain the original reviewer explanation and add a separate AI-generated service-boundary summary. The summary is used in future matching prompts; unrelated profile capabilities remain intact. Summaries use the configured AI provider with a dedicated structured-output schema. Generation runs after the dismissal transaction, so provider failure retains the original correction, displays a warning, and offers a retry. Older corrections have a Summarize correction button. Successful summaries are reused without repeat provider calls. Local checks: API TypeScript, web TypeScript and production build, 25 targeted tests passed. Live generation of the saved Hamid correction was blocked by automatic approval review pending explicit authorization for provider data transfer.
