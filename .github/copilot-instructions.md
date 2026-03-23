Follow the nearest applicable `AGENTS.md` for the files you work on; more specific files override parent files.
When performing a code review, also follow `.github/copilot/REVIEW.md`.

# Code Review Standards

Look for the following:

1. Dead code
2. Duplicate logic
3. All user facing strings must be localized.
4. Unit tests are broken down correctly into individual test cases to avoid having long tests.
5. Suggest descriptive variable/function names where intent is unclear.
6. Flag deeply nested logic that could be extracted into named functions.

# Files to Ignore

Do not review the following auto-generated file types:

- `*.xlf`
- `*.xlf.lcl`
- `*.l10n.json`
