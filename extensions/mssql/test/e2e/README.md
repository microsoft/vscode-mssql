# MSSQL end-to-end tests

Playwright tests that drive VS Code with the MSSQL extension against a real SQL Server. See
[DEVELOPMENT.md](../../../../DEVELOPMENT.md) for setup and how to run them.

## Test tiers

Tests are sorted into tiers with [Playwright tags](https://playwright.dev/docs/test-annotations#tag-tests),
using the constants in [`utils/tags.ts`](utils/tags.ts):

| Tier         | Tag             | Runs                                    | A failure        |
| ------------ | --------------- | --------------------------------------- | ---------------- |
| Pull request | `@pull-request` | On every pull request, and nightly      | Fails the check  |
| Stable       | _(none)_        | Nightly, and on demand                  | Fails the run    |
| Flaky        | `@flaky`        | Nightly, and on demand, without retries | Is only reported |

Pull request tests are a small set of key stable tests, so they also run in the nightly stable
tier. A new test is stable by default.

```ts
import { Tag } from "./utils/tags";

test("Connect to local SQL Database, and disconnect", { tag: Tag.pullRequest }, async () => {});

// Failed in CI: <symptom>. TODO: Stabilize this test, then remove its flaky tag.
test("Publish creates the table", { ...testCases(5878892), tag: Tag.flaky }, async () => {});

// Tag the whole group when its tests depend on each other (serial groups).
test.describe("SQL Database Projects rename refactoring", { tag: Tag.flaky }, () => {});
```

- **Tag a test `@flaky`** when it fails or is flaky in CI, with a comment describing the
  symptom.
- **Remove the tag** once the test passes consistently in the nightly flaky run. Its job summary
  lists each flaky test's result.
- **Tag a test `@pull-request`** only if it is stable, fast, and covers a core scenario. The
  pull request check should stay under about 15 minutes.

`npm run lint` fails if a test is tagged both `@pull-request` and `@flaky`, or has a tag other
than these two, including tags inherited from a `describe` block.

`E2E_TIER` selects the tier to run: `stable` (the default), `pull-request`, `flaky`, or `all`.

```bash
E2E_TIER=flaky npx playwright test
```

The [E2E Nightly](../../../../.github/workflows/e2e-nightly.yml) workflow runs the stable and
flaky tiers as separate jobs; run it from the Actions tab to start one on demand.

## Failure artifacts

`ENABLE_ELECTRON_VIDEO_RECORDING=true` keeps a video clip of each failed test attempt, and
`ENABLE_ELECTRON_TRACING=true` keeps its trace. Both are on in CI, and passing attempts keep
neither.
