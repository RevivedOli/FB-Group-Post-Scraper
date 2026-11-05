# Implementation and validation report

Latest pagination update: **84 offline tests pass**, including relative streamed GraphQL fragments, cursor progression, repeat/no-progress guards, bounded scans and descriptor validation. A live two-page scan retrieved six posts: two known text duplicates and four textless posts. It stopped at `scan_limit`, preserving partial coverage. This supersedes earlier first-batch-only and unverified live-post status below. Per-account/group browser observation supplies the exact feed operation and variables; protected descriptors expire after 24 hours. No authentication headers or CSRF tokens are stored in descriptors. Request spacing and ten-second interpage pauses are configurable; they do not guarantee avoidance of detection. Actual restrictions stop collection. Top posts sorting remains ranked: use age filtering without early cutoff for better recall. Shared posts/checkpoints and per-account sessions remain separate.


Latest age-window change: `posts fetch/sync` accept mutually exclusive `--max-age-hours` and `--max-age-days`, with positive fractional values. Publication-time cutoff is fixed at scan start; old and undated records are excluded with separate counters. Optional `--stop-at-cutoff` stops at the first old record, explicitly sacrifices recall on ranked feeds and keeps global coverage partial. A guarded additive SQLite migration stores filter details in scan history; existing posts are not removed. **73 offline tests pass** and no Facebook requests were made for this update.

Latest text-only change: blank/null/whitespace text is excluded from content inserts, listings and exports. A minimal skipped-ID table preserves observation history, and newly available text can be discovered later. Previously stored textless rows are hidden rather than deleted. Shared source-ID deduplication, per-page automatic persistence and conservative partial checkpoints remain intact. **67 offline tests pass**, with no Facebook requests made for this change.

Latest parser correction: post access is now independent of pagination metadata. A first batch with stable source post identities may be retained with unknown pagination and incomplete coverage; no successful coverage checkpoint advances. Header-only responses remain unverified and return safe structural counts as `feed_not_loaded`. **63 offline tests pass**. No Facebook requests were made for this correction, and the operator’s latest raw response was not available, so live post compatibility remains unverified.

Latest public-source simplification: public groups no longer require manual `group authorise`/access-basis bookkeeping. Account/group rows are created automatically for outcome tracking, with no fabricated authorisation assertion. Private/unknown-source checks, actual authentication failures and Facebook access denials remain enforced. **61 offline tests pass**; no Facebook requests were made.

Latest shared-research correction: successful browser login selects a durable active local account. Explicit `--account` takes precedence, followed by active login, then group preference. Posts, deduplication and checkpoints remain shared by group; session restrictions and per-group access failures are scoped to the account that encountered them. The previous blanket group pause incorrectly treated an account failure as a source-wide restriction and has been removed. Restricted accounts remain blocked, per-account access denials remain preserved, each researcher needs separate access authorisation and there is no automatic fallback/account rotation. A newer successful HTTP verification for the same account permits a manually selected retry of an older authentication failure, without clearing membership denials. No Facebook requests were made, account states were not reset and stored research data were not deleted.

**Latest status (4 November, group-inspection debugging):** 48 offline tests pass. Operator-provided output demonstrates real browser login and HTTP account verification. A bounded live diagnostic verified the target group's header and query descriptor; no live post retrieval was established. Facebook subsequently redirected to a security checkpoint, so requests stopped and the account/group were flagged restricted. The dated sections below describe earlier implementation milestones; this latest section and the final group-inspection update supersede their live-test status and selected collection path.

Date: 4 November 2026. This is implementation, not another architecture investigation.

## Implemented

- Independent `facebook_collector/` Python package and isolated Python 3.12 virtualenv. No existing TypeScript application files were modified by this build.
- Real wrapper for MIT `facebook-gql-scraper` 0.8.3, revision `3933a99a4eaac2e04754165b0ad7582b1ba452e9`. Upstream HEAD matched this commit on inspection. Actual factories/query variables/parsers were read, not inferred from README claims. Direct and transitive dependencies are pinned in the supplied requirements files.
- Local account registration, labels, manual Playwright login, state saving/reloading, explicit verification, manual reauthentication, per-account health, local session deletion and account removal. Cookies remain in private files, not SQLite. No passwords, identity rotation or automatic account creation.
- Group registration, public/private/unknown operator visibility, enable/disable controls, preferred account, per-account access-basis records and inspection that requires actual post access separately from metadata.
- All six requested SQLite tables, created by `storage/schema.sql`, foreign keys, composite post identity, scan provenance, observation timestamps, revisions, checkpoint state and export acknowledgements.
- Bounded group GraphQL pagination from the current head; normalized stable ID, source URL, text and publication time where present. No comment/profile/member/media fetch paths exposed.
- Cross-run deduplication; `new_records` excludes already stored posts. Partial/failing scans retain committed discoveries without advancing completed coverage. Explicit feed-end, missing timestamp, observed ordering and overlap diagnostics.
- CLI account/group/post/scan/export commands, optional TOML configuration, bounded timeouts/retries/request budgets, process locks and stale-run recovery.
- Simple sequential three-hour scheduler, gated on a prior successful manual post retrieval for the selected group/account. It is implemented and mock-tested; autonomous live collection is not enabled/proven.
- JSONL exports, stable event IDs, explicit acknowledgement after consumer success, BNI candidate transformation and missing-permalink deferral. No downstream AI calls, ingestion endpoint or WhatsApp actions.
- Offline regression tests and four explicit live operator scripts, plus an offline Chromium launch check.

## Workspace inspection and integration boundary

The pre-existing project is a TypeScript monorepo, not an existing Python scraper package. It uses Playwright in `apps/api/src/services/browser-session.service.ts`, DOM extraction/storage in `posts.service.ts`, Prisma/SQLite in `prisma/schema.prisma`, AI prefilter/assessment queueing in `ai-assessment.service.ts`, and referral keyword matching in `referrals.service.ts`. No pre-existing project Python environment or requirements file was found in the targeted project inspection. App data paths come from `apps/api/src/config/paths.ts`.

The old save path accepts `saveExtractedPosts(localPrismaGroupId, candidates)` and calls `queuePostAfterScrape()`. The new export deliberately stops before that side effect. Its receiver must map source group ID to the old internal group ID, convert ISO timestamps to `Date`, handle optional nulls, deduplicate `event_id` and acknowledge after durable acceptance. Legacy confidence is a numeric zero sentinel with an unscored warning, so the existing confidence filter may hold imports pending an explicit ingestion policy. This demonstrates transformation compatibility, not a live end-to-end BNI integration. The original database/profile and all pre-existing working changes were preserved.

## Security changes around upstream

The wrapper bypasses the SDK constructor's cookie flattening, plaintext request-state cache and proxy branch (`verify=False`). It uses a dedicated domain/path-aware cookie jar, TLS verification, isolated owner-only session files, no inherited proxy/.netrc configuration and memory-only request tokens/operation caches. Debug request/body/header dumps are disabled, parser output is suppressed, errors are classified without raw upstream exception strings, and only group metadata/feed operations are exposed. Discovery points to the registered target group instead of upstream's unrelated fixed reference group.

Observed SDK weaknesses addressed by tests: empty author arrays crash its post parser; its deferred-fragment merger can ignore scalar-parent patches; discovery catches broad exceptions that can swallow a restriction. The wrapper strips unnecessary author identities before parsing, rejects malformed fragment structure, and latches transport refusals so upstream discovery cannot continue network requests or turn an access restriction into a generic parse error.

Cookie files are protected by local filesystem permissions, **not encrypted by this application**. The SDK operation discovery still uses MiniRacer/V8 to evaluate Facebook bundle modules; its per-bundle evaluation timeout is reduced, but this is not a formally sandboxed code-execution boundary. No unreviewed setup scripts are run with elevated system privileges; dependencies are installed in the isolated environment using the package build backends after inspection of the project packaging declaration.

## Actually tested

| Test | Result and evidence boundary |
|---|---|
| Installation | Python 3.12 virtualenv created; pinned Git revision installed; Playwright 1.64.1 and its Chromium downloaded; `pip check` reports no broken requirements |
| Database | Default empty `data/collector.db` initialized; separate temporary DB tests validate schema, foreign keys, uniqueness, rollback and private permissions |
| New Python suite | **45 tests passed** after the login/session-reuse fix via `python -m unittest discover -s facebook_collector/tests -t . -q` |
| SDK parsing | Actual upstream group query/parser/factory executed with synthetic group/metadata responses; two full wrapper→SQLite scans yield one discovery then zero duplicate discoveries |
| Account state | Mocked interactive browser flow, positive/negative account-page markers, multi-account isolation and cookie renewal/attribute preservation pass; no real account login performed |
| Incremental/recovery | Ranked old-first feed, edits, missing time, capped/truncated pages, repeated cursor, authentication/restriction/parser failures, interrupted runs, DB write failure and per-page rollback covered |
| Export | Retryable identical event IDs, explicit idempotent ack, no-overwrite publication, missing-permalink deferral and existing-field transformation covered |
| Scheduler | Due times, manual-scan gate, unhealthy-account suspension and sequential lock behavior covered with mocked collectors |
| CLI | Fresh data-directory subprocess tests cover init, account/group registration, safe missing-credential failure, list commands, scheduler, export and unknown acknowledgement |
| Browser runtime | **Real Chromium launched headlessly and rendered a local in-memory HTML page successfully**. No Facebook page/session was involved |
| Existing application | `npm test`: **39 tests passed across 7 files**, unchanged |
| Static checks | Python compilation and new-code whitespace checks pass; default DB/session/venv paths verified ignored by Git |

All fixture post text/IDs/cookies are synthetic. There is **no live Facebook collection evidence**. The operator scripts were supplied but not run against real accounts/groups. Account/session files from the old app were not accessed or reused.

## Remaining limits and exact next live check

No credentials and no specifically permitted live test group were supplied. Accordingly no real authentication, group lookup, post retrieval, anonymous access, throughput, recall or sustained scheduler compatibility was demonstrated. No Facebook failure was fabricated; collection was not attempted. Account privacy/member permissions and platform/data-use permission remain operator responsibilities.

This version requires numeric group IDs and an authenticated account. Anonymous and slug resolution are not enabled. It uses one sequential scanner; multi-worker concurrency and the optional UI are deferred. End-of-accessible-feed is the only complete-coverage stop; observed chronological order does not justify an early cutoff. This can repeatedly retrieve historical content and often yields partial coverage under caps. Zero initial posts remain unverified. Missing source fields remain null and the parser cannot prove upstream text completeness. Existing-post edit notifications after acknowledgement, deletion reconciliation, at-rest application encryption and an automatic old-system importer are future work.

**Next live check:** run `account add` to log in manually with an existing authorised account; record a numeric permitted group's access basis; run `group inspect`, then `posts fetch --limit 20` and two `posts sync` commands. Compare actual IDs, text, URLs and timestamps with the ordinary browser view, verify repeated posts have zero new discovery events, and inspect the scan's coverage flags. Stop on any challenge/refusal. Only after that manual test should the scheduler gate be satisfied for that group/account. Full setup and exact commands are in `README.md`.

## Login/session-reuse fix after operator feedback

The operator reported completing Facebook's visual verification and seeing their own profile, yet receiving `Login/security check is incomplete; no session saved.` The old code produced that message **before reading or saving storage state**, solely from a substring check on the originally opened page's URL. It also created a new empty ephemeral context on every attempt, discarding normal device/browser state. The exact tab/URL state from those failed attempts was not recorded, so a stale original tab is a supported reproduction, not a confirmed reconstruction of the operator's session.

Manual login now uses a separate mode-700 persistent profile per registered account. Confirmation considers all Facebook tabs, parses the URL path rather than query substrings, checks live required cookies plus authenticated-page evidence, and keeps the browser open when confirmation is inconclusive. A newer active checkpoint is not overridden by an older logged-in tab. Existing saved cookies seed a new profile; missing login session cookies can be restored on reopening without overwriting genuine device/preferences cookies. Deleting a saved session also removes its dedicated profile.

Browser confirmation saves the session as `saved_unverified`, records browser verification explicitly and does not immediately perform an HTTP verification. `account test` remains the explicit separate HTTP check and scheduler eligibility gate. No fake browsing history, synthetic device identity, challenge solving or stealth configuration was introduced.

Validation: 45 offline tests pass, including stale original tab/new authenticated tab, login strings in query parameters, unfinished verification retry, cancellation, account profile isolation, cookie migration and active-checkpoint rejection. A real native Chromium test closed/reopened a temporary profile and verified a synthetic persistent cookie without accessing any website. The operator's actual Facebook login has not been rerun by the agent; retry `account login` with the existing account ID rather than creating another account.

## Group-inspection update

The operator's HTTP account verification succeeded but the SDK metadata factory failed. A bounded diagnostic confirmed failure during hovercard operation discovery; its reduced diagnostic request budget was exhausted without producing metadata. A separate normal group-page read returned the requested group header and current `CometGroupDiscussionRootSuccessQuery` descriptor. The initial HTML feed contained a section-header unit only, not posts. Replaying the current discussion query produced no verifiable post-page pagination metadata, so it was rejected rather than counted as a successful feed. A subsequent page request redirected to `/checkpoint`; testing stopped immediately, and the account/group status was set to restricted. No author/post text or session credentials were printed, and no raw response was stored.

Production metadata now uses an identity-scoped JSON bootstrap reader instead of requiring the SDK hovercard/About queries. It retains only the registered group's name/privacy and its page-provided operation descriptor/token in memory. The first-page route reuses the SDK HTTP transport/request logic and post parser, with explicit `data.group` to `data.node` shape adaptation. It uses page-provided provider variables and requests non-deferred feed loading where that flag is exposed. This last adjustment remains live unverified because the checkpoint stopped further testing.

Metadata and feed outcomes are independent: valid metadata plus a malformed/header-only feed returns verified metadata with `feed_access: unverified` and a nonzero CLI exit. Restrictions remain hard errors and suspend collection. Because the root query has no known cursor argument, it cannot safely paginate using the legacy query's cursor contract; the currently selected route yields one bounded batch and marks further coverage partial (`pagination_unavailable`). `legacy_pages()` retains the pinned cursor implementation for offline compatibility tests only. No new historical-coverage guarantee was introduced.

48 offline tests pass, including current bootstrap metadata without hovercard requests, first-page SDK parsing to SQLite, preservation of provider variables, header-only feed rejection and unsupported-continuation partial checkpoints. No live posts were verified. The next network action must follow operator completion of the normal security checkpoint and explicit account verification, not an automatic retry, identity switch or alternate egress.
