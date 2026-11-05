# Visitor Opportunities — saved-post trial

The local UI has Potential Visitors, Target Categories and Exclusions tabs. Run **Trial saved posts** to analyse the saved application posts without Facebook requests, AI charges, notifications or outreach. This is deliberately an explicit trial, not an automatic new-post pipeline.

Seeds come from the user's supplied 5 November specification, not a fresh verification of the external workbook: 10 editable categories, 32 chapter-member exclusions, 39 outreach records and 3 additional known exclusions. Seeding inserts missing records and never overwrites edits or statuses. Lettings carries a seat-overlap review flag. Drafted invitations remain drafted. The additional referral-introduction lists were referenced but not supplied individually and cannot be seeded from this document.

Candidate selection is deterministic: category phrases plus published business contact information, an explicit business label, or a business-offer phrase. This is a broad discovery filter, not proof of category eligibility or ownership. Category include/exclude rules and overlap flags are displayed for human review. Geography is based on text mentions, not verified coordinates or a measured 10-mile radius. Unknown locations remain unverified. Ads outside the referral phrase filter can be candidates; referral assessments, matches and notifications are unchanged.

A company name is extracted when explicitly labelled or published with a legal company suffix in the post. Otherwise the public website domain or an unidentified-business label is used. Grouping uses an exact business domain or normalised UK phone, not a person's display name. Social networks and common link shorteners are not company identifiers. Accounts are represented by the author names actually stored with source posts; the existing collector does not save author profile URLs, so none are invented. Verified owner names and account URLs can be recorded in review notes. Shared contact details can still produce an incorrect match: inspect source evidence before acting.

Manual merges require matching outreach statuses and retain identity aliases so future trial runs attach evidence to the merged business. Source posts are not deleted. Evidence is unique by post/category and repeat trials are idempotent. Publication date is used for activity, falling back explicitly to discovery date if missing. The default window is 30 days; all-time evidence is retained. Count appearances by source post and distinct creative by normalised exact text hash (ignoring web links and punctuation). Near-duplicate copy with changed wording is not semantically deduplicated. Rankings cover collected evidence only.

Exclusions remain visible under Exclusions and can be disabled deliberately; closed statuses are hidden from the default prospect list. The trial does not imply an email was sent. Outreach remains manual. No automatic email, Facebook messaging, identity inference, or membership verification is performed.

Schema migration: `20261105110000_visitor_opportunities`. Use the existing `npm run db:migrate` backup-and-deploy procedure before restarting the API. Saved posts and referrals are preserved.

## Verification — 5 November 2026

- API TypeScript build/typecheck passed; 97 API tests passed, including isolated SQLite visitor trials, repeat-run deduplication, preserved draft/edit state and merge-alias persistence.
- Live additive migration applied successfully after a SQLite backup. The running API was briefly stopped to release migration locks and restarted; recurring collection remains enabled with a persisted next-run time.
- Live trial: 3,085 saved posts reviewed, 42 candidate posts, 47 post/category evidence links, 23 company candidates across all dates. Eight candidates have activity in the default 30-day view. A second run added zero duplicate evidence links.
- Browser verification: sidebar navigation, both primary views, 10 categories, 74 exclusions, letting-agent overlap flag, source-post disclosure, dates and company-name refresh all displayed successfully.
- Vite transformed the new UI page successfully. Full frontend TypeScript validation was stopped after stalling on cold MUI dependency-file reads for over 15 minutes; it is not claimed as passing. No frontend type error was reported before that stall.
