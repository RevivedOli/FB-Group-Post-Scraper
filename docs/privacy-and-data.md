# Privacy and local data

The application is designed as a local-only personal tool. Runtime data defaults to `~/Library/Application Support/FacebookGroupMonitor` and can be moved with `FB_MONITOR_DATA_DIR`.

Phase 1 does not collect Facebook post content, browser sessions, cookies, screenshots, or traces.

Phase 2 creates a persistent browser profile for manual Facebook login at `~/Library/Application Support/FacebookGroupMonitor/browser-profile` by default. That profile can contain cookies and other browser session data, so it must remain local and out of Git.

Phase 3 records group access state, run timestamps, warning counts, and error messages in the local SQLite database. It does not store Facebook post content.

Phase 4 records run summaries and live activity events in the local SQLite database. These records include configured group names, access-check messages, counters, warnings, and error text, but not post bodies.

Phase 5 stores captured Facebook post text, source URLs, timestamp labels, extraction confidence, and review status in the local SQLite database. Treat the database as sensitive local data.

Phase 6 records crawl progress, scroll counts, stop reasons, and cancellation events in the local SQLite database.

Phase 7 stores additional parser metadata locally, including visible author names, parsed or raw timestamp labels, image counts, permalink identifiers, extraction confidence, and field warnings.

Phase 8 stores local human review status for posts. Review actions do not transmit post content or review decisions outside the local application.

Phase 9 stores referral directory members, keyword lists, and post-match decisions in the local SQLite database. Matching is deterministic and local-only.

Later phases must keep browser profile data, diagnostics, databases, screenshots, traces, and exports out of Git.
