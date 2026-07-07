/* GENERATED — do not edit. Source of truth: perftest/packages/perf-contracts/src/central/.
 * Re-vendor: copy the src/central/*.ts files here with this header (see
 * perf-contracts test/centralVendorSync.test.ts, which pins byte equality).
 * Contract central/1.0 — one projection implementation, two writers. */
/**
 * Central observability store contract (central design §4, review addendum).
 * Everything the two writers share: canonical digests, upload policies,
 * envelope copies, row DTOs, projection, and the SQL literal encoder.
 *
 * This folder is vendored into vscode-mssql as generated code — keep it
 * dependency-free (node:crypto only) and side-effect-free.
 */

export * from "./digest";
export * from "./policies";
export * from "./envelope";
export * from "./dto";
export * from "./encode";
export * from "./projection";
