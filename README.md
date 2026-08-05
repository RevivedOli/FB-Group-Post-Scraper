# Local Group Monitor

Local-first Facebook group monitoring application scaffold. Phase 1 includes the TypeScript monorepo, Express API, Prisma/SQLite schema, Material UI shell, settings, and groups CRUD. Phase 2 adds a manually controlled local Facebook browser session using an isolated persistent Chrome profile. Phase 3 adds group access testing and single-group run records. Phase 4 adds dashboard run summaries, live activity history, and all-enabled-group monitoring runs. Phase 5 adds bounded visible-post extraction and local post review. Phase 6 adds real crawl controls, progress polling, and run cancellation. Phase 7 improves parser quality with post author, timestamp, permalink, image-count, confidence, and warning metadata. Phase 8 adds a post review queue with filters, status actions, and local cleanup controls. Phase 9 adds a local referral directory and deterministic keyword matching.

## Development

```bash
npm install
npm run prisma:generate
npm run dev
```

Local application data defaults to `~/Library/Application Support/FacebookGroupMonitor` and can be overridden with `FB_MONITOR_DATA_DIR`.

## Phase 2 Browser Session

The Dashboard browser controls can open Facebook login, open Facebook home, check whether the current profile appears logged in, and close the managed browser. Profile data is stored locally at `~/Library/Application Support/FacebookGroupMonitor/browser-profile` by default.

Phase 2 does not scrape Facebook content or automate Facebook interactions beyond navigating to login/home pages for manual sign-in.

## Phase 3 Group Checks

The Groups page can test access for a configured Facebook group and run a single-group navigation check. Phase 3 records group access status, last test timestamps, run status, warnings, and errors in the local SQLite database.

Phase 3 does not store Facebook post content. Post extraction and persistence belong to a later parser phase.

## Phase 4 Run Activity

The Dashboard can start a run across all enabled groups, show run status metrics, and display recent run events. Phase 4 persists run/event records in SQLite so failures and warnings are visible after refresh.

Phase 4 still does not store Facebook post content. It only records run metadata, group access messages, and counters.

## Phase 5 Post Collection

Group runs now inspect visible Facebook post containers, save newly discovered posts to SQLite, and update existing posts when they are seen again. The Posts page lists collected posts with review/analysis status and source links.

Phase 5 stores captured post text locally. The extractor is bounded by each group's `maxPostsPerRun` and `maxScrollActions` settings when present.

## Phase 6 Crawl Controls

Dashboard runs now start in the background, update progress while running, and can be stopped with `Stop Run`. Group cards expose crawl limits for max posts, max scrolls, and max seconds.

The crawler stops when it reaches max posts, max scroll actions, max duration, enough consecutive known posts, the end of the feed, or a user cancellation.

## Phase 7 Parser Quality

Post extraction now parses Facebook group permalink variants, stores the best author/timestamp/image metadata it can find, and records extraction confidence plus field warnings for review. Existing posts are updated when seen again so parser improvements can enrich older local records.

When a visible post does not expose a permalink immediately, the crawler hovers timestamp-like elements and rereads the post DOM before falling back to a local hash. Facebook can still show a browser status-bar URL without exposing it as a readable page `href`, so hash fallbacks remain possible.

## Phase 8 Review Queue

The Posts page can filter by review status, group, and search text. Individual posts can be marked `useful`, `requires_review`, or `ignored`, and ignored posts can be deleted in bulk from local storage.

## Phase 9 Referral Directory

The Referral Directory page stores local referral members with categories and comma-separated keywords. Matching runs compare active members against locally collected, non-ignored posts and produce suggested matches with keyword evidence and scores. No AI or external service is used for matching in this phase.
