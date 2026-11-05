# GPT-6 Luna, Telegram alerts and recurring collection

Implemented 4 November 2026. Existing posts, review decisions, matches and provider credentials were preserved.

## Model

The live OpenAI selection is now `gpt-6-luna`. The curated catalog records standard short-context rates of $0.10/M input, $0.01/M cached input and $0.50/M output, with catalog version 2026-11-04. Responses requests retain strict JSON schema output, specify reasoning effort `none`, and allow 2,000 output tokens. Chat Completions fallback uses the corresponding nonreasoning setting and completion limit. Incomplete Responses are explicit failures, not negative referral decisions. Existing queued assessments retain their recorded model; new assessments use the selected model.

A live comparison reused 20 saved GPT-5.6 Luna model inputs (10 with referral matches, 10 without) and their original prompts. All 20 target calls completed with parseable output. Intent agreement was 19/20 and exact member-ID agreement was 18/20. All recommended member IDs were valid and scores met the current application threshold. Estimated target cost was $0.01393691. These are agreements with historical model decisions, not independent accuracy labels or a guarantee of identical results. Disagreements are retained for review in `docs/research/model-comparison-gpt-6-luna.json`; no production assessments or match decisions were overwritten by evaluation.

The reusable comparison script is `npx tsx scripts/compare-referral-models.ts`. It uses the existing Keychain credential; it does not print the key. It incurs API charges when run.

Official sources checked:
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/docs/guides/reasoning
- https://developers.openai.com/api/docs/pricing

## Telegram setup

Open Settings → Telegram referral alerts:

1. In Telegram, create your bot through @BotFather with `/newbot`.
2. Enter its token in the password field and Save Bot Token. It is stored in macOS Keychain, outside SQLite, and is never returned by the status API.
3. Open your bot's private chat in Telegram and send `/start`.
4. Click Find My Private Chat. If multiple private chats exist, explicitly enter your intended numeric chat ID instead.
5. Save Notification Settings, then Send Test Notification. The test button sends a fixed test message only to the saved private chat.
6. Select the minimum model score (default 80%), enable notifications and save.

No bot token or private destination was available during implementation, so notifications remain disabled. No Telegram message was sent and live phone delivery remains unverified. Configuration, outbox behavior, retry paths and message formatting were validated locally. The application only needs outbound requests to Telegram; a public webhook or public app URL is unnecessary for initial delivery. Telegram buttons open the original Facebook post and copy the introduction; they do not send a Facebook comment or WhatsApp message. The desktop's localhost URL will not open the desktop app from a phone.

Each alert includes the matched member, model score, group, publication time when available, post excerpt, suggested introduction and original Facebook URL. Long post text is excerpted; Open Facebook shows the source. Model percentages are not calibrated probabilities or evidence of the member's actual availability.

Alerts are persisted as `NotificationDelivery` rows in the same SQLite transaction as successful assessment/member matches. The key is unique by source application post/member/channel, and replaying or re-assessing a pair does not create another normal alert. Rows are excluded if the post was first collected before enablement time, avoiding a historical backlog. Source-age filtering remains controlled by collection settings. Pending/running/failed assessments and nonmatching posts do not create alerts.

The dispatcher claims work atomically, observes rate-limit retry delays, applies exponential retry backoff and marks exhausted rows failed after eight attempts. Status and errors are visible in Settings, with a retry-failed action. Disabled or changed destinations cancel unsent pending/retry rows; the worker checks the current configuration between sends. In-flight requests cannot be unsent. Delivery is at least once: if Telegram accepts a message but its acknowledgement is lost, a retry can produce a duplicate despite local deduplication. Incoming messages other than private `/start` are not persisted or processed. New notification and collector controls reject unrelated browser origins.

Migration `20261104223000_notification_delivery` was applied after a database backup via `npm run db:migrate`. Run that command before starting an upgraded copy elsewhere. No existing table or rows were deleted.

Telegram sources:
- https://core.telegram.org/bots/features#botfather
- https://core.telegram.org/bots/api#sendmessage
- https://core.telegram.org/bots/api#inlinekeyboardbutton

## Recurring collection

Hourly collection is enabled for the currently enabled UI group list. Initial next due time was 4 November 2026 at 23:21:26 UK/UTC. Limits are seven hours of publication age, five pages and 50 inspected posts per group, preserving request/page/group spacing and a single sequential worker. Settings exposes interval and limits; minimum interval is 15 minutes. Dashboard shows enabled/paused state and next run time. Stop also pauses the recurring schedule.

Due times are persisted before dispatch. A busy worker is not overlapped. Actual authentication/security failures pause future cycles until the operator completes recovery and re-enables scheduling. Previous failures before re-enablement do not immediately pause a recovered schedule again. The app and Mac must remain running; this is an in-process timer with durable configuration, not an OS launch-at-login service. Cross-machine coordination is not supplied. No timed recurring cycle has yet reached its due time during validation; dispatch/backoff guards have local tests.

Validation completed: 71 API tests (including real temporary-SQLite outbox deduplication and rollback), TypeScript checks and production build passed. Existing collector tests remained at 98 passing from the pagination validation; this rollout did not change Python collection code. Telegram sending remains unverified until credentials and a private destination are configured.

## Runtime estimate and compact schedule form

Recurring collection fields now use a responsive four-column grid on large screens, two columns on smaller screens and a single column on phones. The save button fits its label. A read-only runtime-estimate endpoint uses up to 200 completed scan timing summaries, enabled UI groups, configured page/post caps and existing pacing. Groups with timing samples use a median fixed overhead plus configured page pacing; unknown groups use the pooled median or a first-run pacing estimate. Named groups without numeric IDs are counted as skipped. The displayed 0.75–1.4× range is a rough planning range, not a calibrated confidence interval, and assumes configured page caps are reached. Early feed exhaustion may be faster; discovery/retries may be slower. AI and notification processing are excluded.

Live verification returned 31 enabled groups, 28 numeric sources, 3 unresolved named groups, 32 valid timing samples and 11 groups with their own samples: estimated 26–51 minutes at five pages/50 posts. The UI warns if the point estimate exceeds the selected interval. No schedule timings were changed by this layout/estimate update. 78 API tests and TypeScript checks passed.

## Variable pacing and shuffled cycles

Recurring settings now expose minimum/maximum cycle pause (minutes), request spacing (seconds), page pause (seconds), and group pause (seconds), plus a shuffle toggle. Each actual wait draws independently from a uniform range. Equal bounds retain fixed timing. The cycle pause is drawn after collection finishes, rather than permitting immediate catch-up after an overlong cycle. A restart with an interrupted cycle restores a full pause. Timing choices and due times are persisted. Old interval settings are read as the minimum, with a maximum 15 minutes longer; legacy API callers supplying only intervalMinutes can still request fixed timing.

Current saved values: 15–30 minute cycle pause, 5–10 seconds between requests, 10–20 seconds between pages, 10–30 seconds between groups, shuffled order enabled. The already scheduled 5 November 00:01 start was preserved. Manual UI cycles use the saved pacing too. Standalone Python ui_worker input accepts the same pacing fields. Ordinary posts sync CLI options retain their explicit fixed timing behaviour unless ranged arguments are provided programmatically.

The group execution time budget is a separate configurable cap (30–600 seconds, current 180); it is not randomized, because varying a budget changes coverage rather than pacing. A selected page pause beyond the remaining budget fails with partial coverage before sleeping. Request-budget/deadline and authentication checks remain enforced. Timing variation is not a guarantee of avoiding automation detection, and no fingerprint masking, account rotation or security-check bypass was introduced.

The estimate uses the selected mean request/page/group pauses. UI ranges are compact and editable. Testing covers range validation, equal bounds, sampling, shuffling without mutating the input group list, sequential execution, saved settings passed to the worker, and scheduling a fresh pause after completion. 100 Python tests, 82 API tests, TypeScript checks and production build passed.

## Overnight runtime failure, 5 November

Read-only audit at approximately 06:18 UK/UTC found no collector scans or newly created AI assessments after midnight. The last scheduled cycle began 4 November at 23:21:36: the first group completed five pages with one new text post; the next group saved one new text post before interruption at 23:22:55. Telegram configuration remained enabled and its only delivery was the successful 23:23 explicit simulation; no failed delivery rows explained the missing overnight alerts. The saved next due time (01:05) was overdue. The UI was listening on 5182 while API port 3001 refused connections.

The retained API process log showed repeated tsx watcher restarts on dependency file events and a final ECANCELED dependency-file read error. This establishes a backend/runtime failure, not a Telegram rejection. The exact onset of the overnight outage cannot be reconstructed from the retained evidence alone. No particular sleep/cloud-sync cause was established.

Stopped the stranded watcher. Added `scripts/collector-api.mjs`, which runs the already built API without a development watcher and restarts it on exit using a 5–60 second backoff. `npm run collector:api` starts it. The combined collector:ui launcher now builds and uses that supervisor for future launches. Launcher syntax checks passed. A fresh rebuild attempt was slow and was cancelled; recovery used the last successfully built API (4 November 23:55), which already includes the latest application source changes.

Recovery startup also briefly stalled while reading a dependency but completed. Live API health returned OK, and the overdue enabled schedule dispatched at 06:22:04 on 5 November, with the worker running Ascot People and 31 selected groups. This verifies recovery and dispatch, not completion of the full cycle. The supervisor still requires its process/session and Mac to remain running; no launch-at-login service, independent availability monitor, or anti-sleep configuration was installed.
