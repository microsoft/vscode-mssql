# Performance Harness Import Provenance

This directory was imported into `vscode-mssql` from the local
`kburtram/perftest` checkout on 2026-08-24.

- Source commit: `860365ff65f9bbb4e102309860004d8e9bdf36f4`
- Source backup branch: `backup/pre-migration-20260824`
- Import branch: `dev/karlb/perftest_tools_import`
- Import method: `git archive` of tracked files only

The source checkout's untracked `.tmp/sts-validation/` directory was not
imported. Generated reports (`central-report.html`, `history.html`, comparison
and trend HTML files, and `setup-report.json`) were also excluded. The old
standalone repository workflow was excluded because workflows nested below
`tools/perftest/.github/workflows` are not executed by GitHub Actions.

`IMPLEMENTATION_PLAN.md` and `PROGRESS.md` are retained as frozen historical
context only; they are not current product documentation.

## Scenario migration policy

The harness engine, scenario registry, fixtures, and unit tests are imported as
one coherent tool. Unit tests run in the tooling PR because they validate the
harness, not unreleased product behavior. End-to-end scenarios are opt-in; run a
feature-specific scenario only after the matching product feature is present on
the branch under test. Add or revise feature-specific scenarios in the product
PR that makes them runnable.

Do not copy changes back and forth between this directory and the old standalone
checkout. After this import lands, `tools/perftest` is the maintained source.
