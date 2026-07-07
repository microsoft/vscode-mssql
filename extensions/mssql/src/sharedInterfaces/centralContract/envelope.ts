/* GENERATED — do not edit. Source of truth: perftest/packages/perf-contracts/src/central/.
 * Re-vendor: copy the src/central/*.ts files here with this header (see
 * perf-contracts test/centralVendorSync.test.ts, which pins byte equality).
 * Contract central/1.0 — one projection implementation, two writers. */
/**
 * Structural copies of the vscode-mssql diagnostics envelope contracts that
 * the central projection consumes (review addendum F3-F8). The product's
 * sharedInterfaces/debugConsole.ts remains the source of truth for capture;
 * product-side vendor tests pin these copies against it so they cannot drift.
 *
 * UNION_VERSIONS below is recorded in central.schema_info and used to
 * generate CHECK constraints; `perftest central check` flags skew (H-2).
 */

import type { ClassifiedValueShape, DataClassification } from "./policies";

export type DiagProcess =
  | "extensionHost"
  | "webview"
  | "renderer"
  | "sqlToolsService"
  | "sqlServer"
  | "harness"
  | "system";

export type DiagKind =
  | "event"
  | "span"
  | "metric"
  | "request"
  | "response"
  | "sqlActivity"
  | "renderPhase"
  | "gap"
  | "state";

export type DiagStatus = "ok" | "info" | "warning" | "error" | "blocked" | "partial";

export type DiagTimingClass =
  | "officialSameProcess"
  | "productTimer"
  | "epochAlignedDiagnostic"
  | "collectorDiagnostic"
  | "inferred";

export const DIAG_EVENT_SCHEMA_VERSION = "mssql.diag.event/1";
export const SESSION_MANIFEST_SCHEMA_VERSION = "mssql.diag.sessionManifest/1";

/** Version stamp for the vendored unions, recorded in schema_info (H-2). */
export const UNION_VERSIONS = Object.freeze({
  version: "diag-unions/1",
  process: [
    "extensionHost",
    "webview",
    "renderer",
    "sqlToolsService",
    "sqlServer",
    "harness",
    "system",
  ] as readonly DiagProcess[],
  kind: [
    "event",
    "span",
    "metric",
    "request",
    "response",
    "sqlActivity",
    "renderPhase",
    "gap",
    "state",
  ] as readonly DiagKind[],
  status: ["ok", "info", "warning", "error", "blocked", "partial"] as readonly DiagStatus[],
  timingClass: [
    "officialSameProcess",
    "productTimer",
    "epochAlignedDiagnostic",
    "collectorDiagnostic",
    "inferred",
  ] as readonly DiagTimingClass[],
});

export interface DiagClassificationSummaryShape {
  max: DataClassification;
  redactedFields: number;
  policyId: string;
}

export interface DiagEventShape {
  schemaVersion: string;
  eventId: string;
  sessionId: string;
  seq: number;
  epochMs: number;
  monotonicNs?: string;
  process: DiagProcess;
  pid?: number;
  feature: string;
  kind: DiagKind;
  type: string;
  status: DiagStatus;
  traceId?: string;
  causeEventId?: string;
  entity?: { kind: string; id: string };
  durationMs?: number;
  timingClass?: DiagTimingClass;
  payload?: Record<string, ClassifiedValueShape>;
  cls: DiagClassificationSummaryShape;
  tags?: string[];
}

export interface GapRecordShape {
  kind: "gap";
  gapId: string;
  sessionId: string;
  fromSeq: number;
  throughSeq: number;
  droppedCount: number;
  reason: "subscriberOverflow" | "sinkOverflow" | "journalUnavailable";
  firstAvailableSeq?: number;
  backfillStatus: "notStarted" | "running" | "succeeded" | "partial" | "failed";
  epochMs: number;
}

export interface ProvenanceSummaryShape {
  extensionVersion?: string;
  commit?: string;
  dirty?: boolean;
  environmentHash?: string;
  vscodeVersion?: string;
  stsVersion?: string;
  machineLabel?: string;
}

export interface SessionManifestShape {
  schemaVersion: string;
  sessionId: string;
  createdUtc: string;
  updatedUtc: string;
  source: "live" | "perfRun" | "bundle";
  captureMode: "off" | "redacted" | "digest" | "full";
  policyId: string;
  eventCount: number;
  gapCount: number;
  segments: Array<{ file: string; firstSeq: number; lastSeq: number; events: number }>;
  sizeBytes?: number;
  droppedRanges?: Array<{ fromSeq: number; throughSeq: number }>;
  provenance: ProvenanceSummaryShape;
  status: "active" | "closed" | "partial";
}

/** A journal line is either an event or an interleaved gap record (F5). */
export type JournalLine = DiagEventShape | GapRecordShape;

export function isGapRecord(line: JournalLine): line is GapRecordShape {
  return (line as GapRecordShape).kind === "gap" && typeof (line as GapRecordShape).gapId === "string";
}
