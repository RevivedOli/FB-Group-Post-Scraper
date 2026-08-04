# Facebook parser fixtures

Automated tests should use synthetic fixtures first and sanitised real HTML snippets later. Do not repeatedly access Facebook from automated tests.

When real fixtures are needed, save only the smallest sanitised HTML snippet required to test parser behaviour and remove names, profile links, comments, reactions, and unrelated personal data.
