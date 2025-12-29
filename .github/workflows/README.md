# GitHub Actions Workflows

## Publish Baseline Artifacts (`publish-baseline.yml`)

### Purpose
Creates baseline artifacts (VSIX packages size metrics) that PRs can compare against to detect regressions in vsix size.

### How it works
1. **Triggered automatically** on push to `main` or `release/*` branches
2. **Can be triggered manually** via workflow_dispatch for testing without pushing code
3. **Builds all extensions**: `mssql`, `sql-database-projects`, and `data-workspace`
4. **Packages them into VSIX files** and records their sizes in KB
5. **Uploads artifact** with 90-day retention:
   - `baseline-sizes`: JSON file containing size metadata for comparisons (VSIX files themselves are not stored to save space)

## Build and Test (`build-and-test.yml`)

### How it uses baseline artifacts

1. **Downloads baseline sizes** from the target branch (`main` or `release/*`) that the PR is targeting
2. **Compares VSIX sizes**:
   - Calculates size difference in KB and percentage change
   - Fails if VSIX size increases by more than 5%
   - Uses icons (🟢 decrease, 🔴 increase, ⚪ no change) in PR comments
3. **Posts comparison results** as a PR comment showing:
   - Target branch VSIX size
   - PR branch VSIX size
   - Difference in KB and percentage
4. **Coverage comparison** (implicit): Baseline coverage is used by Codecov to show coverage changes

### When baseline comparison runs
The workflow only performs baseline comparisons when:
- The PR targets `main` branch, OR
- The PR targets a `release/*` branch

This is controlled by the `should_compare_baseline` environment variable set early in the workflow.
