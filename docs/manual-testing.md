# Manual testing

Phase 1 manual testing checks the local app foundation:

1. Install dependencies with `npm install`.
2. Generate Prisma client with `npm run prisma:generate`.
3. Start the local app with `npm run dev`.
4. Open the web UI and verify Dashboard, Groups, Posts, Referral Directory, and Settings navigation.
5. Add a Facebook group URL on the Groups page and confirm it is stored with a canonical URL.

Phase 2 manual testing checks the local browser session:

1. Start the local app with `npm run dev`.
2. On the Dashboard, click `Open Facebook Login`.
3. Confirm a Chrome window opens to Facebook login.
4. Log in manually if needed.
5. Return to the Dashboard and click `Check Login`.
6. Confirm the status changes to `Logged in` when the persistent profile is authenticated.
7. Click `Close Browser` when finished.

Phase 3 manual testing checks configured group access:

1. Add a Facebook group URL on the Groups page.
2. Make sure the Dashboard browser session is logged in when testing private groups.
3. Click `Test Access` for the group.
4. Confirm the group card shows `accessible`, `login_required`, `unavailable`, or `unknown`.
5. Click `Run Group`.
6. Confirm a local run record is created and the group card updates its last run status when access is available.

Do not run automated tests against Facebook. Post extraction and persistence begin in later phases.

Phase 4 manual testing checks dashboard run activity:

1. Start the local app with `npm run dev`.
2. Open the Dashboard and confirm summary cards load from the API.
3. Click `Run Enabled Groups`.
4. Confirm the run completes and the Live Activity panel shows run events.
5. If no groups are enabled, confirm the dashboard records a warning instead of failing.

Phase 5 manual testing checks post collection:

1. Log into Facebook through the Dashboard browser session.
2. Add or enable a group that the logged-in account can access.
3. Click `Run Group` from the Groups page or `Run Enabled Groups` from the Dashboard.
4. Confirm the Dashboard shows non-zero post counters when posts are visible.
5. Open the Posts page and confirm collected posts appear.
6. Run the same group again and confirm already-known posts update without increasing `newPostsSaved`.

Captured post text is stored locally in SQLite.

Phase 6 manual testing checks crawl controls:

1. On the Groups page, set `Max scrolls` to a small value such as `3`.
2. Start `Run Enabled Groups` from the Dashboard.
3. Confirm the Dashboard changes to `running` and updates post/scroll counters.
4. Click `Stop Run`.
5. Confirm the run changes to `cancelled` and a cancellation event appears.
6. Increase `Max scrolls` for deeper collection runs.

Phase 7 manual testing checks parser metadata:

1. Run a group that has visible posts.
2. Open the Posts page and confirm posts show source group, review status, analysis status, extraction confidence, and image count.
3. For posts where Facebook exposes the fields in the visible feed, confirm author and timestamp chips appear.
4. Hover-visible timestamp links are attempted automatically during extraction; run the same group again and confirm existing posts are enriched or updated without duplicating the same canonical post URL.

Cleanup controls:

1. On the Posts page, use `Delete` on an individual post when you want to remove a bad local capture.
2. On the Groups page, use `Clear Data` to delete that group's local posts and run history while keeping the group configured.
3. Use `Delete Group` only when you want to remove the group configuration as well.

Phase 8 manual testing checks post review:

1. Open the Posts page after collecting posts.
2. Use the `Review`, `Group`, and `Search` controls to narrow the list.
3. Mark a post as `Useful`, `Review`, or `Ignore` and confirm the status chip updates.
4. Use `Delete Ignored` only after confirming ignored posts should be removed from local storage.

Phase 9 manual testing checks the referral directory:

1. Open Referral Directory.
2. Add a referral member with a category and comma-separated keywords.
3. Click `Generate Matches`.
4. Confirm suggested matches show the member, category, score, and matched keywords when collected posts contain those terms.
5. Mark a match `Accept` or `Dismiss` and confirm it moves when the status filter changes.
