# Saved-data integration and group update delivery

Verified 4 November 2026.

## Implemented and running

The Python collector stores source posts at `facebook_collector/data/collector.db`. The existing application uses `~/Library/Application Support/FacebookGroupMonitor/database/app.sqlite`. A read-only, bounded Python snapshot now feeds an idempotent application-side importer. It carries group/source IDs, text, publication time and first/last observations, without reading account or session tables. Application posts preserve review status and first discovery on replay. A durable cursor advances after persistence and the existing AI queue handoff; a failed batch retries. Source rows and export acknowledgements remain untouched.

The API checks this local handoff every 30 seconds, coalescing simultaneous requests. The Posts page reports connection/errors and offers Update from collector. Its data refreshes every 30 seconds. It starts on Posts by default. New groups imported from the collector are disabled in the original DOM scraper to avoid accidentally running a second collection path. CLI collection settings remain authoritative.

Start the local UI/API together from the repository root with `npm run collector:ui`; default URL is http://127.0.0.1:5182/. This is a development process, not a launch-at-login service. Stop existing instances before starting another. `FACEBOOK_COLLECTOR_DATA_DIR` selects the source directory; `COLLECTOR_PYTHON` can select Python 3; `FB_MONITOR_DATA_DIR` still controls application storage. No database schema migration was required. Built desktop packaging of the Python bridge is not yet provided.

The existing `queuePostAfterScrape` applies the application's enabled/automatic-analysis settings, phrase prefilter, eligibility checks and LLM queue. The bridge does not enable providers, alter prompts or rewrite the referral directory. Matching results remain reviewable in the existing Referral Queue. Structured HTTP eligibility now checks a numeric source permalink, matching Facebook post ID and sufficient text instead of applying the DOM extraction-confidence threshold. The score remains zero/unscored; browser-scraped posts retain their existing threshold. A versioned durable bridge cursor replayed the existing saved posts once through the corrected policy, retaining review decisions and assessment deduplication. Live validation: all eight received decisions, six skipped by the phrase prefilter, two completed LLM assessment; both were classified as advertising with no referral opportunity and no member matches. Repeated handoff created zero duplicate assessments. The bulk AI rerun selector includes these structured records, with actual eligibility still enforced downstream. On this machine enabled, automatic analysis and prefilter were already on.

## Can collection subscribe to a group?

Repository finding: `facebook_collector` has paginated HTTP reads and a sequential due-time scheduler, with no WebSocket, server-sent event or subscription consumer. Its captured descriptor is a pagination operation, not a subscription. Saved browser cookies do not themselves supply a durable subscription or a complete event stream.

Official-source checks attempted:
- https://developers.facebook.com/blog/post/2024/01/23/introducing-facebook-graph-and-marketing-api-v19/
- https://developers.facebook.com/docs/graph-api/changelog/version19.0/
- https://developers.facebook.com/docs/graph-api/webhooks/reference/

Meta returned HTTP 429/fetch errors to the research browser. Consequently a currently supported group-post webhook has **not** been verified, and there is no validated replacement transport to implement here. Do not describe this as live push collection. A browser visibly adding a post is not evidence of complete delivery for all groups or all posts.

A bounded follow-up experiment could keep one legitimately accessible group tab open, observe normal DOM changes and network event types, and correlate a user-created test post against a stable source ID, arrival time and reconnect behavior. It must not fabricate subscriptions, replay unknown private protocols, solve challenges or use account rotation. It requires a real new post to establish delivery; cached loads and synthetic events do not prove push. Even a successful observation is best-effort, and should retain periodic catch-up scans. Many open tabs may generate more background requests, not fewer.

## Proposed next phase

1. Bulk-import a text/CSV list of group URLs, resolving numeric identities where legitimately available, deduplicating the list and exposing enabled state/interval/last outcome in one collector view. First access must establish actual group feed compatibility; current scheduler requires a successful manual scan for the selected account/group.
2. Run one sequential worker with shared request spacing across groups, explicit max age/pages/posts, due times, bounded backoff and visible errors. Existing scheduling is sequential and protected by a local scheduler lock, but the CLI scheduler does not yet expose all per-scan age options. It has not been launched by this change.
3. Keep shared group/post deduplication and local durable delivery into the existing prefilter → AI assessment → referral queue. Test restart recovery and source revisions with real saved data before unattended use.
4. For future multi-worker operation, introduce atomic shared group claims with expiring leases and renewal, plus a global request budget. Current local locks are useful for one shared machine; they are not a distributed queue or a cross-machine rate limiter. Adding more workers must not allow two workers to claim the same group.

For N groups with mean scan duration S and group-to-group pause D, a single worker's minimum round duration is roughly N × (S + D). Polling cannot promise instant discovery, especially on ranked feeds. Age filtering skips old posts without early cutoff; stopping on an old ranked post can miss newer posts farther down.

## Validation

- 89 Python tests and 50 API tests passed; TypeScript typecheck and the production build passed.
- Local API health and Vite returned HTTP 200. Live handoff reported 8 text posts; querying Posts by the imported collector group returned all 8. The source contained 12 total historical rows, including 4 textless rows excluded from UI import.
- Browser automation could not open the local UI due to browser-control errors, so visual interaction was not verified. API/database verification is complete; no new Facebook scan or push-delivery experiment was run.

## Multiple-group controls (4 November, later update)

Dashboard now controls the Python collector, replacing the old browser-run summary/login controls. The existing Groups list is used directly by the UI worker: Test Access/Collect Group select one source; Test Enabled Groups/Collect Enabled Groups select the enabled set. Enable/Disable Collection changes that list. Named URLs can be given a numeric ID on their card; unresolved names produce `numeric_id_required`, not a fabricated access denial. Legacy keyword matching now explains that its counts are keyword suggestions, not new posts or confirmed AI referrals.

The UI starts `python -m facebook_collector.ui_worker` with JSON configuration through stdin. The module is also callable from a terminal with a JSON specification. It registers numeric groups locally without assuming public visibility, freezes the active account for the cycle and verifies actual feed access. A group access test examines a small batch without saving posts; Collect saves eligible text posts and triggers the existing local handoff/filter/AI pipeline. No interactive pagination capture is attempted in background cycles. Groups without a captured continuation descriptor may only yield the first batch, reported as partial/pagination unavailable.

One child worker runs per API process, and an OS lock prevents simultaneous UI-worker cycles on this shared machine. Requests are spaced by at least five seconds, pages and groups by ten seconds; per-group deadline is three minutes. Defaults are seven hours, five pages and fifty posts per group. Bounds are configurable in the UI. Security/authentication failures stop the cycle; group-specific access failures are reported and the cycle continues. Stop sends SIGINT, allowing the collector to retain committed posts and record an interrupted scan.

Each completed group outcome updates the UI database with its current test status and timestamp. Worker progress itself is in memory and resets if the development API restarts; saved posts and group outcomes remain durable. Cycles run once, not continuously on a schedule. The existing separate CLI scheduler is not started by these controls. Do not run the old browser endpoints or a second scheduler alongside the UI worker. Cross-machine leases, an unattended recurring service, and automatic resolution of named group URLs remain future work.

Validation: 93 Python tests, 53 API tests, typecheck and production build passed. Tests cover sequential pacing, stopping after a restriction, named-group reporting, repeat-collection deduplication, child-process exclusivity, cancellation and limits.

Bounded live worker validation completed using active account `fb_82d1ced38cfc`, Facebook profile `61596463280842`: BRACKNELL LOCAL BUSINESSES AND SERVICES (983908805062935) and Ascot People (313186276449503) each returned `feed_access=verified_posts`, nine sample posts, and `pagination_status=continuation_unavailable`. Both outcomes were persisted to the existing UI Group records; the two-group cycle completed. This was an access test, not a content collection run, and no other saved groups were tested. A preceding attempt was interrupted by the development server restarting during a build, so it was not counted as a completed test. The development command now excludes dist/data outputs from watching; an already-running old watcher needs restarting to apply that option.


## Automatic pagination update

Pagination no longer requires a manual descriptor capture per group. Existing and new numeric groups use the same automatic route: verify the requested group header, load a valid same-group descriptor or reuse the same account's fresh pagination operation definition with rebound group identity and a cleared cursor, otherwise discover the operation using the pinned SDK. Only documented arguments/provider flags are portable, and topic/comment filters are cleared. Query IDs identify operations rather than groups; this matches the SDK's operation cache and per-request group arguments. Session cookies and cursors are never shared between accounts. A definition is cached privately for the target group only after its first response parses successfully. An automatically selected stale query can use the SDK's invalidation/discovery retry; authentication/security failures and request/deadline bounds still stop collection.

The old root-query parser remains test-covered for compatibility but is no longer the normal first-page-only fallback. Failure to discover a query returns pagination_discovery_failed. A feed response that itself omits pagination still remains partial rather than inventing a cursor. Access failures, unsupported named URLs without numeric IDs, and Facebook-imposed limitations remain explicit exceptions to availability.

Validation: upstream automatic discovery returned a query ID in a bounded live check (9 requests); 97 Python tests pass, including new-group cursor progression, automatic fresh discovery, account isolation and explicit discovery failure. TypeScript checks passed. Saved scan history confirmed two pages on BRACKNELL LOCAL BUSINESSES AND SERVICES, stopping at the configured cap. The old development watcher interrupted later progress; the API has now been restarted with dist/data exclusions applied.

Final automatic-pagination validation: both 983908805062935 and 313186276449503 completed two pages, fetched five posts each and stopped at scan_limit. Zero new posts were inserted in those bounded repeat scans. The second group required no manual capture. Expired definitions now rediscover automatically, and successful definitions are refreshed after parsing. Final checks: 98 Python tests, 53 API tests, TypeScript checks and production build passed.

## Pending boiler-service referral investigation

The Lightwater boiler-service post (29389961613941266) passed the phrase prefilter on `need a`. Its assessment was pending with a null referral flag, no rendered request and no model response. The UI incorrectly treated null as false and showed Not referral; it also described enqueue-only metadata (member IDs and filter settings) as full model input. Completed decisions now require a boolean referral flag and completed status before displaying a referral verdict. Pending details explicitly distinguish queue metadata from an assembled model request; actual input is persisted before the provider call.

A queue wake flag now rechecks pending work when an enqueue arrives after an empty claim while a running job is draining. The regression test reproduces that timing without a provider call. Payload assembly is separately tested to contain full post text and member profiles, not just IDs. This is a code-level race finding; the historic pending row alone does not prove the exact interleaving that created it.

The existing pending assessment resumed on API restart and completed as looking_for_help, with all 33 active member profiles in its saved input. Jon Bennett was matched at a model-reported 100%. No duplicate assessment was created for this investigation. 55 API tests and TypeScript checks pass.

## Posts filtering and locked application database, 5 November

User screenshots showed Looking for help selected while displaying unrelated prefilter-skipped advertisements, alongside Prisma socket timeouts and collector handoff errors. Reproduction established that the application SQLite database was locked: a separate read-only sqlite3 connection also failed with database is locked. The API was reachable, but filtered requests failed. Only the application API process held the database open, with multiple connection handles. The database used rollback-journal (delete) mode.

Stopped the API after confirming its collector worker was completed. Created a consistent SQLite backup `app.sqlite.pre-wal-20261105T102416Z.bak` in the application's backups directory, enabled WAL and obtained quick_check=ok. Application Prisma uses one SQLite connection with a bounded 15-second busy timeout and bounded transaction limits; startup ensures WAL before launching workers. Future migration backups now use SQLite's backup API rather than copying only the main file, preserving committed WAL contents.

The frontend previously retained old posts/counts on a failed filtered request. It now clears stale data on filter transitions/failure, ignores superseded async responses and clears the error after a successful request. Search is applied explicitly with the Search button. Pagination exposes all matching results rather than only the first 25.

A separate backend issue was historical assessment matching: `some` could match an old help classification while the card displayed a newer incompatible assessment. AI predicates now apply to the same latest completed assessment per post, and that assessment is displayed. Looking for help does not require a directory member match; referrals-only and member filters narrow it separately. The rule is explained in the view.

Live validation after recovery: Looking for help returned 271 posts, advertising 434, and Looking for help + referrals-only 25. Returned cards' assessments matched the selected intents. Requests completed in approximately 0.1–2 seconds. Collector handoff error cleared. The running Vite server compiled and served the changed Posts component with HTTP 200. 87 API regression tests plus one focused real-SQLite reader/writer isolation test passed. Backend typecheck completed; the full UI typecheck stalled on dependency metadata file reads and was cancelled without an emitted code error. No visual browser interaction was claimed.
