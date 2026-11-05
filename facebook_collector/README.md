# Local Facebook collector proof of concept

An independent Python + SQLite utility alongside the existing TypeScript app. It does not invoke AI, BNI matching or WhatsApp, and never opens the existing app's browser profile or database. CLI first; no new web UI.

**Status:** Pagination is now selected automatically for existing and newly registered numeric groups. A current query definition is reused only within the same login, with the target group ID substituted and the cursor cleared. Without a valid definition, the upstream operation-discovery path runs automatically. No first-page-only fallback is selected when discovery fails. The library's request budget, time limits and actual access checks still apply. **98 offline tests pass.**

Use one command to select chronological order and collect:

```bash
python -m facebook_collector.cli posts sync 579056282244709 --sort chronological --max-age-hours 7 --max-pages 5 --limit 50 --request-delay-seconds 5 --page-delay-seconds 10
```

If the saved feed descriptor already matches, collection starts directly. Otherwise the command opens the browser: choose **New posts**, scroll to load more posts, then press Enter. The same command then continues collecting. If the requested order cannot be verified, it stops before collection. Omitting `--sort` retains the saved feed order.

## Setup

From the repository root, with Python **3.11+** (tested on 3.12):

```bash
python3.12 -m venv facebook_collector/.venv
source facebook_collector/.venv/bin/activate
python -m pip install -r facebook_collector/requirements.lock.txt
python -m playwright install chromium
python -m facebook_collector.cli init
python -m unittest discover -s facebook_collector/tests -t . -v
```

The isolated `.venv` is already created in this workspace. The browser binary is a separate Playwright download. On Linux, install the platform's documented Chromium system dependencies as necessary. No Docker/server is needed. CLI also works as `python facebook_collector/cli.py ...`, or `python cli.py ...` inside this directory.

`requirements.txt` pins direct dependencies; `requirements.lock.txt` records every installed dependency from the tested environment. The only scraping library is MIT-licensed [`XD-MHLOO/facebook-gql-scraper`](https://github.com/XD-MHLOO/facebook-gql-scraper), revision **`3933a99a4eaac2e04754165b0ad7582b1ba452e9`**, SDK version 0.8.3. Current upstream HEAD matched that revision when inspected. The selected route reuses its HTTP query machinery, JSONL consolidation and post parser with page-provided discussion descriptors. The legacy metadata factory and cursor/discovery path remain covered by offline compatibility tests. Playwright is used only for manual account login.

The default local data directory is `facebook_collector/data/`:

```text
data/collector.db           # all six tables are created from storage/schema.sql
data/sessions/fb_<id>.json  # separate Playwright storage state for each account
data/profiles/fb_<id>/     # persistent browser/device state for manual login
data/locks/                # local OS file locks for groups/accounts/scheduler
```

This directory, virtualenv, databases and session files are ignored by Git. Data/session directories use mode 700; session/database files mode 600. Secrets are **not encrypted by this utility**: use a private OS account/encrypted disk for local protection. Cookies are never in SQLite or CLI arguments. Backups of this directory contain credentials and post text. `--data-dir PATH` or `FACEBOOK_COLLECTOR_DATA_DIR` selects a separate location; global options precede the subcommand. The existing app uses `~/Library/Application Support/FacebookGroupMonitor/database/app.sqlite`; this utility never reads or writes it.

## Accounts

Manual account selection now follows **explicit `--account` → active account → group preferred account**. A successful browser login automatically becomes active for later commands using the same data directory. Inspection/scan output includes the selected local account and Facebook profile ID. Registering/logging in does not copy another person's group permissions.

```bash
python -m facebook_collector.cli account current
python -m facebook_collector.cli account use ACCOUNT_ID
python -m facebook_collector.cli account clear-active
```

`account use` selects an existing saved login locally; it makes no Facebook request. `clear-active` removes only the default preference, retaining sessions and the documented group-preference fallback. New group registration uses the active login if no explicit account is supplied. The scheduler also uses this selection order and still requires that exact account/group pair to pass its manual-test gate.

Posts, deduplication and checkpoints are shared per group; credentials and access failures belong to each researcher/account. `groups.access_status` is the most recent attempt's outcome, not a global ban on the group. A restricted account remains blocked, and a group-specific denial remains attached to that account/group pair. Selecting another researcher never copies access permissions or automatically clears any failure. A later successful HTTP authentication check for the same account allows a manually selected retry of an older authentication failure; it does not clear membership/access denials. There is no automatic fallback to another account. Active selection is saved in `local_preferences`, separate from cookie files. For private separation between people, use separate OS users or separate private data locations; this utility's shared data directory is not a multi-user security boundary.

For shared research, one authorised person's scan and another person's later scan use the same group/post keys and group checkpoint. Previously saved posts are not emitted as new again, and first/last scan provenance remains recorded. Requests may still re-fetch visible posts to discover changes; shared deduplication cannot guarantee zero repeated downloads. Public groups need no manual access-basis record. Private/unknown groups retain their explicit per-account access record.

```bash
python -m facebook_collector.cli account add --label "My authorised account"
# Opens Chromium. Log in and complete checks yourself, then press Enter in terminal.
# The JSON output includes a generated account ID, e.g. fb_ab0123456789.

python -m facebook_collector.cli account list
python -m facebook_collector.cli account test fb_ab0123456789
python -m facebook_collector.cli account login fb_ab0123456789
python -m facebook_collector.cli account delete-session fb_ab0123456789
python -m facebook_collector.cli account remove fb_ab0123456789

# Register metadata without launching a browser:
python -m facebook_collector.cli account add --label "Another account" --no-login
```

`account login` opens a dedicated persistent browser profile for that account. It checks all Facebook tabs, so a stale original login tab does not invalidate a newly opened authenticated profile tab. Both the required live cookies and an authenticated-page signal are required. An incomplete confirmation prints safe diagnostics and leaves the browser open for you to finish manually; type `cancel` to stop. Genuine browser state is preserved for the next attempt. No browsing history, cookies or human-verification responses are fabricated.

On success the result says `session_saved: true`, `browser_login_verified: true` and `status: saved_unverified`. This means the **browser** login succeeded; `account test` is a separate HTTP collector verification. A later HTTP failure does not mean the browser cookies were never saved. The scheduler still requires a healthy HTTP verification before running.

`account test` needs a positively identified own-account marker in an authenticated homepage; cookie presence alone is insufficient. If Facebook changes those markers it reports authentication unverified instead of inventing success. It does not fetch unrelated profiles or display a guessed display name. Account label is operator-supplied; profile ID comes from the verified browser session/account page. Credentials, domain, path, expiry, secure, HttpOnly and SameSite attributes remain in the private session file. HTTP cookie replacements are merged back after collection; SDK operation IDs/tokens remain memory-only.

**Retry an existing account with `account login ACCOUNT_ID`, not `account add`.** Each `add` creates a separate account and profile, even with the same label. Successful login changes the active default but does not rewrite group registrations or clear restrictions. The dedicated profile may help preserve normal device recognition, but Facebook can still require verification and its exact risk signals are unknown. Local `delete-session` also removes that account's dedicated browser profile and clears it as active; it does not touch another account or your usual browser profile.

Restricted/challenged sessions are suspended. The scheduler skips unhealthy accounts and never switches identities. Re-authenticate manually with `account login`; `account test` is an explicit operator recheck, not an automated bypass. Deleting a session removes only the local copy, not the remote Facebook login; revoke remotely in Facebook when needed. Passwords are never stored. Automatic account creation, fake profiles, joining, CAPTCHA handling and proxies are absent.

## Groups and permission records

This version accepts **numeric group IDs** or numeric group URLs. Vanity/slugs return a clear numeric-ID-required error. There is no automatic group discovery or membership submission.

```bash
python -m facebook_collector.cli group add \
  https://www.facebook.com/groups/123456789 \
  --name "Permitted test group" --visibility public \
  --account fb_ab0123456789 \
  --access-basis "Existing authorised account; permission to collect for this test recorded separately"

python -m facebook_collector.cli group list
python -m facebook_collector.cli group inspect 123456789
python -m facebook_collector.cli group inspect 123456789 --account fb_ab0123456789

# Authorise an additional legitimate account independently:
python -m facebook_collector.cli group authorise 123456789 \
  --account fb_abcdef123456 --access-basis "Documented membership and collection approval"
python -m facebook_collector.cli group configure 123456789 --account fb_abcdef123456
python -m facebook_collector.cli group configure 123456789 --enabled no
python -m facebook_collector.cli group configure 123456789 --interval-seconds 10800
```

Public group collection/inspection no longer requires `group authorise` or `--access-basis`. The selected login is used directly; an empty-basis tracking row records actual access outcomes without asserting independently verified permission. Private registration still requires an account and nonempty access basis, and private/unknown sources retain their explicit per-account record. Group metadata is obtained from the requested page’s JSON bootstrap; inspection separately attempts an actual feed page. A shell/name/HTTP 200 is not reported as accessible posts. An empty first page is deliberately unverified, even if genuinely empty; this proof of concept has no independent empty-group ground truth. Visibility in the registry is operator-declared; returned metadata privacy is shown separately. Permission is not inferred from technical visibility.

Group metadata now comes directly from JSON in the requested group's page, avoiding the SDK's failing hovercard/About prerequisite. The first-post adapter uses the discussion operation ID and provider variables actually supplied by that page, keeping the upstream HTTP request implementation and post parser. A root discussion response uses `data.group`, which is explicitly adapted to the pinned parser's `data.node` contract. Header-only responses remain unverified and are never counted as posts. Inspection can return `metadata_status: verified` together with `feed_access: unverified`, a safe `feed_error`, and exit code 1.

Multipage collection now prepares its query definition automatically. Manual browser capture remains an optional diagnostic/override:

```bash
python -m facebook_collector.cli group capture-pagination 579056282244709
```

In the browser, choose New posts if available and scroll until more posts load, then press Enter in the terminal. `--auto` instead performs a bounded automatic capture; it may retain Top posts sorting. The protected descriptor contains query variables and an operation ID, without authentication headers or CSRF tokens; it expires after 24 hours. Recapture if expired or rejected. Without a valid descriptor, the collector first checks this login’s current query definitions, then discovers the upstream pagination operation. Query IDs are operation-specific; each request supplies its own group ID. Source cursors and filters are never transferred. Discovery failure is explicit and no first-page-only fallback is selected.

```bash
python -m facebook_collector.cli posts sync 579056282244709 \
  --max-age-hours 7 --max-pages 5 --limit 50 \
  --request-delay-seconds 5 --page-delay-seconds 10
```

Page pauses default to ten seconds; request intervals default to two seconds, with a minimum of two seconds for either setting. These limits reduce request frequency; they do not guarantee avoidance of automation detection. Limits, deadlines, missing/repeated cursors and access failures stop further requests. Posts already committed remain saved if interrupted. The CLI deadline defaults to ten minutes.


The selected SDK expects cookies and a request token. Anonymous mode is **not enabled** because it was not validated and this SDK path is authenticated. There is no invisible fallback to the old DOM scraper.

## Posts and checkpoints

Optional publication-age windows apply to both `posts fetch` and `posts sync`:

```bash
# Save text posts from the last seven days, checking the bounded batch for any newer entries.
python -m facebook_collector.cli posts sync 123456789 --max-age-days 7

# Speed-first: stop processing at the first post older than six hours.
python -m facebook_collector.cli posts sync 123456789 --max-age-hours 6 --stop-at-cutoff
```

Choose either hours or days, not both; positive fractional values are supported. The cutoff is fixed at scan start in UTC and uses publication time, not discovery time. The boundary is inclusive. Older posts are counted as `skipped_old`; posts without a usable publication timestamp are excluded under an age filter and counted as `skipped_missing_timestamp`. Existing older saved posts are not deleted. Scan history records the cutoff, age option, early-stop setting and separate skip counts. Existing databases receive an additive `scan_runs.filter_details` column automatically.

`--stop-at-cutoff` is an explicit speed/completeness tradeoff: a ranked feed or pinned old post may appear before newer posts, so stopping there can miss them. It reports `stop_reason: age_cutoff`, never complete global coverage, and does not advance the shared successful coverage checkpoint. Without this flag, old posts are skipped while the remaining bounded batch is examined. The current HTTP page has already been downloaded when processing stops; this flag cannot undo that transfer . Age-filtered runs do not claim complete unfiltered historical coverage. No age limit is applied unless specified.

Scans save automatically into local SQLite. No separate Save command is needed. `posts fetch` and `posts sync` are one-shot commands: they read a bounded batch, persist results and exit. Only `schedule` loops continuously; Ctrl-C stops it or an in-progress scan. Already committed pages remain saved, and an interrupted/partial scan does not advance successful coverage.

The default content policy is text-only. Null, empty and whitespace-only text is skipped and counted as `skipped_no_text`. Skipped source IDs/times are remembered in `skipped_posts`, without storing a content record or emitting a discovery. They can be saved later if text appears. Older textless content rows are retained for history but excluded from normal lists/exports; no historical rows are deleted automatically. Existing saved text is preserved when a later response omits it. `--limit` still caps inspected source records, including textless ones; it does not guarantee that many text-bearing results.

Running sync again compares stable group/post IDs against the shared database. An unchanged batch emits zero new text posts; duplicate and skipped counts explain what was observed. It still retrieves the recent batch to detect changes. It does not stop on the first known post or claim that no other unseen posts exist elsewhere in the group. It follows observed cursors up to the configured limits and reports partial coverage when capped. `feed_sorting` identifies the captured order; observed timestamp order alone does not establish chronological sorting.

```bash
python -m facebook_collector.cli posts fetch 123456789 --limit 20
python -m facebook_collector.cli posts sync 123456789 --limit 100 --max-pages 20 --overlap-hours 24
python -m facebook_collector.cli posts list 123456789 --limit 20
python -m facebook_collector.cli scans list
```

Both fetch and sync store idempotently; both emit only `new_records` discovered by that invocation. `fetch` defaults to 20 posts, `sync` to 100. Counts include already stored records, so a second unchanged scan has `new_posts: 0` and duplicates counted. Export acknowledgements are independent. A stable **numeric source post ID + group ID** is mandatory; raw `pfbid` alone/text hashes are not accepted as stable identity. A source-provided pfbid permalink is allowed when a separate numeric source ID exists. Missing URL/text/publication time remain null; no inferred author, timestamp or fallback link is fabricated. Comments, profiles, media downloads and member enumeration are not performed.

SQLite stores first/last observation, publication time, source URL, scan provenance, revisions and export acknowledgement. Edits update the same record without creating a second discovery event. Existing non-null time/URL/text survive a later missing value. `collector` is `facebook_gql`. A new discovery can be an old post; `is_new` does not mean newly published.

Example result (illustrative, not a live test):

```json
{
  "group_id": "123456789",
  "posts_fetched": 20,
  "new_posts": 4,
  "duplicates": 16,
  "scan_completed": true,
  "coverage_complete": false,
  "stop_reason": "scan_limit"
}
```

`scan_completed` means the bounded command finished normally; **coverage_complete** requires explicit end-of-feed without a truncated page. A cap, failure or interruption never advances `coverage_end`/`last_successful_scan`. Partial scans still retain discovered posts and their provenance. Per-page transactions prevent losing all progress; checkpoint finalization is a separate transaction after session persistence. On process death the next scan of that group marks its stale running row interrupted while holding the group lock.

Every scan starts at the feed head. The overlap cutoff is the last completed scan's start time minus `overlap_hours`; `reached_overlap` records whether it was observed. `chronological_verified` describes only the retrieved sample (at least two uniquely identified, timed posts in nonincreasing timestamp order). **It is not a global Facebook feed guarantee and is never used for early stopping.** A group too large to exhaust within the page/post budget remains partial. Scans now stop after 10 consecutive distinct, unchanged text posts already saved before the current run. A new or edited post resets the streak; repeated copies of one post do not advance it. The count carries across pages. This saves repeat-scan time but may miss unseen posts farther down a ranked feed, so coverage remains partial and completed coverage checkpoints do not advance. CLI: `--stop-after-known N`; use `0` to disable for deeper scans. Recurring UI collection uses the default of 10. Runs report `known_post_streak` and persist the threshold and final streak in scan diagnostics.

Wrong-group responses, malformed post identity, repeated cursors and access refusals still fail explicitly. For the current first-batch route, identifiable posts can be retained even when pagination metadata is absent: pagination is marked unverified, continuation is disabled and coverage remains partial. Missing pagination is never treated as end-of-feed. Header/layout units without identifiable post nodes produce `feed_not_loaded`, with safe counts rather than raw responses or credentials; this does not mean the group is empty. A malformed deferred fragment is rejected rather than accepting the upstream merger's partial result. These checks cannot establish that Facebook supplied every eligible post or that the source text was not truncated upstream.

## Scheduling

```bash
python -m facebook_collector.cli schedule --once
python -m facebook_collector.cli schedule
```

One sequential process, no worker framework. Default per-group interval **3 hours**, 30-second local scheduler tick. Each group/account pair first needs a normal manual scan returning at least one actual post, and account status must be authenticated. Until that happens it prints `manual_scan_required`/`account_not_healthy`. This gate has been tested with mocks; live scheduled collection has not been enabled. Partial/manual results do not establish complete coverage.

The process records due times, holds OS account/group locks and reuses saved session files across runs/restarts. It does not survive machine shutdown by itself: run the documented command under a local process supervisor later if wanted. Ctrl-C stops it. Request pacing defaults to two seconds between request starts, timeouts are bounded and transient network/5xx errors receive at most two retries. Restrictions/authentication errors are not retried or routed to another account. Concurrency is deliberately fixed at **one**, configurable intervals/budgets are provided; multiple workers are outside this proof of concept.

Optional settings use standard-library TOML, avoiding a YAML dependency:

```bash
python -m facebook_collector.cli --config facebook_collector/config.example.toml posts sync 123456789
```

All HTTP, including operation discovery/bootstrap, shares a request/time budget. TLS verification stays on, implicit environment proxies/.netrc are disabled, and redirects are limited to HTTPS Facebook/CDN hosts. Only group metadata/feed query classes are exposed. Unknown schema/error cases stop rather than log raw data. The upstream discovery implementation evaluates Facebook bundle modules in MiniRacer to find operation IDs; execution time per bundle is reduced to two seconds, but this is still native V8 executing remote code, not a formally isolated sandbox. No arbitrary external domains/setup scripts are executed by our collector. No stealth/TLS impersonation plugins are installed.

## Export to the previous BNI workflow

```bash
python -m facebook_collector.cli export write /tmp/collector-batch-001.jsonl
python -m facebook_collector.cli export write /tmp/collector-legacy-001.jsonl --legacy

# Only after the consumer durably accepts this record:
python -m facebook_collector.cli export ack --group 123456789 --post 987654321
```

Exports are atomic mode-600 JSONL files; existing destinations are never overwritten. Writing a file does **not** mark records exported. Re-exporting before acknowledgement repeats records with stable `event_id = facebook:<group>:<post>`, allowing an idempotent receiver to recover. Acknowledgements are idempotent and require the composite group/post key. Normalized exports preserve missing URL/text explicitly; legacy exports defer missing-permalink records, report a `deferred` count and leave those records pending. Revisions do not generate another discovery export after acknowledgement; edit-event delivery is future work.

Python interface:

```python
from facebook_collector.storage.database import Database
from facebook_collector.export import Exporter

db = Database('/path/to/private/collector-data')
try:
    bridge = Exporter(db)
    pending = bridge.get_unprocessed_posts()
    bridge.export_new_posts('/tmp/new-batch.jsonl', legacy=True)
    # After durable consumer success:
    bridge.mark_post_exported(post_id='987654321', group_id='123456789')
finally:
    db.close()
```

Existing path traced: `posts.service.ts` extracts DOM candidates → `saveExtractedPosts()` stores Prisma Post records → `queuePostAfterScrape()` performs eligibility/keyword filtering and queues AI assessment → existing referral/member matching uses those stored records. Deterministic keyword matching also exists in `referrals.service.ts`. The legacy export contains `facebookGroupId` plus `candidate` fields matching `ExtractedPostCandidate`: `facebookPostId`, `canonicalPostUrl`, `text`, `originalPostedAt`, image metadata/warnings and extraction method. **The receiver must resolve the source group to its internal Prisma Group.id, convert ISO time to Date and map optional nulls to undefined where required.** No receiver/import endpoint has been added and no classifier was changed. The required numeric confidence field is **0 as an unscored safety sentinel**, with a `confidence_not_scored` warning; the existing confidence gate may therefore hold imported posts until the receiver applies an explicit validated policy. False/zero image fields plus `media_collected: false` mean media was not collected, not a claim of no media.

If matching is rebuilt later, keep the stable event/group/post identifiers and accept this normalized contract through an explicit idempotent import boundary. Do not couple Facebook cookies, SDK objects or scans to business rules. That redesign is not implemented here.

## Operator validation scripts

After permission, manual login and group registration:

```bash
python facebook_collector/scripts/test_account.py fb_ab0123456789
python facebook_collector/scripts/test_group.py 123456789
python facebook_collector/scripts/test_posts.py 123456789
python facebook_collector/scripts/test_incremental.py 123456789
```

These scripts make real requests when explicitly invoked; they are **not** part of the offline test suite and were not run against Facebook. `FACEBOOK_COLLECTOR_DATA_DIR` also works here. The repeated-scan script prints both results: unchanged reference posts must not be new again; newly published posts between scans are legitimate new discoveries.

Next live check requires the operator to clear Facebook's security checkpoint manually, reauthenticate the same account ID and explicitly verify HTTP authentication. Then perform one group inspection and a small fetch if permitted. Record field completeness and any refusal; do not describe post collection as live-compatible until it succeeds. This implementation does not borrow the old application's session or assume that its membership authorises systematic collection.

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for exact validation results and remaining limits.

## View saved posts in the existing UI

From the repository root, run `npm run collector:ui` and open http://127.0.0.1:5182/. The Posts page reads imported collector text posts alongside the existing application data. The local API checks for saved source updates every 30 seconds, preserving review decisions and source-ID deduplication. Update from collector forces an immediate handoff without contacting Facebook. The existing prefilter/automatic AI settings govern downstream analysis. New imported groups are disabled in the original browser scraper so this handoff does not enable another collection path.

This development server must stay running. It does not start Facebook scans or provide a push subscription. See `docs/research/collector-pipeline-next-steps.md` for evidence and remaining scheduler/subscription work.

Structured collector posts now enter the existing phrase filter and automatic AI queue using source identity and text checks rather than the DOM confidence threshold. Nonmatching posts retain a visible skipped decision without an LLM call; matching posts record the trigger phrase and proceed according to current AI settings.

## Multiple groups from the UI

Dashboard and Groups now start the same bounded Python worker. Add URLs with Groups → Add Group, enable the desired sources, then use Test Enabled Groups. Each result records real feed access separately from metadata. Collect Enabled Groups runs one sequential cycle with configurable lookback/page/post limits and feeds saved discoveries into the relevance pipeline. Stop interrupts the active cycle; committed posts remain saved. This is not yet a recurring unattended scheduler.

For a named URL, supply its numeric Facebook group ID in the Groups card. Named URLs are reported as `numeric_id_required` until resolved; they are not silently treated as inaccessible. Pagination setup is automatic for new groups as well. Manual `group capture-pagination GROUP_ID` remains available for diagnostics, but normal collection does not require a capture for each group. If a returned response itself lacks pagination metadata, coverage remains partial and is reported explicitly.

The headless cycle entry point is `python -m facebook_collector.ui_worker` with a JSON specification on stdin, for example:

```bash
printf '%s' '{"mode":"test","groups":[{"ui_id":"example","name":"Example group","reference":"579056282244709"}]}' | python -m facebook_collector.ui_worker
```

This selects the active saved account and returns JSONL summary events without post text. Use `mode: "run"`, `max_age_hours`, `max_pages` and `limit` for a bounded collection cycle. The UI supplies its own saved group list through that same interface. No passwords or cookies belong in this input.
