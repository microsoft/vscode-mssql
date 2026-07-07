/* GENERATED — do not edit. Source of truth: perftest/packages/perf-contracts/src/central/.
 * Re-vendor: copy the src/central/*.ts files here with this header (see
 * perf-contracts test/centralVendorSync.test.ts, which pins byte equality).
 * Contract central/1.0 — one projection implementation, two writers. */
/**
 * Canonical projection: local ground truth → central row streams + preview
 * (central design §4/§7.3, review addendum C-1/C-4..C-10/C-15).
 *
 * Pure functions over parsed inputs — no filesystem, no clock, no randomness.
 * Each writer has a thin loader that assembles the input (parsed JSON files,
 * relative paths, per-file sha256); the projection itself must produce
 * byte-identical canonical row streams in perftest and in the vendored
 * vscode-mssql copy (conformance test T-B5).
 *
 * The preview is generated FROM the projected item stream (never a second
 * estimator), and upload uses the same stream — if preview and upload counts
 * diverge the upload fails before commit.
 */

import { canonicalJson, digestCanonical, digestString } from "./digest";
import {
  type CentralArtifactRefRow,
  type CentralDiagEventRow,
  type CentralDiagGapRow,
  type CentralDiagSessionRow,
  type CentralEnvironmentRow,
  type CentralMetricRow,
  type CentralProjection,
  type CentralRepetitionRow,
  type CentralRunRepositoryRow,
  type CentralRunRow,
  type CentralScenarioRow,
  type CentralValidationRow,
  CENTRAL_CONTRACT_VERSION,
  CENTRAL_PROJECTOR_VERSION,
  type UploadItemKind,
  type UploadItemPayload,
  type UploadPreview,
  type UploadPreviewFieldNote,
  type UploadPreviewRefusal,
} from "./dto";
import { sanitizePayloadString } from "./encode";
import {
  type DiagEventShape,
  type GapRecordShape,
  isGapRecord,
  type JournalLine,
  type SessionManifestShape,
} from "./envelope";
import {
  type ClassifiedValueShape,
  clsRank,
  type ColumnAction,
  type DataClassification,
  getUploadPolicy,
  maxClassification,
  PERF_TWIN_COLUMN_RULES,
  PROVENANCE_FIELD_RULES,
  type UploadPolicy,
  type UploadPolicyId,
} from "./policies";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface SourceFileInfo {
  /** Relative to the run/session root, forward slashes. */
  relativePath: string;
  sha256: string;
  sizeBytes: number;
}

export interface DiagSessionSource {
  manifest: SessionManifestShape;
  /** Journal lines per segment, seq order, matching manifest.segments order. */
  segments: Array<{ file: string; lines: JournalLine[] }>;
  /** Inventory: manifest + segment files (for source summary only). */
  files: SourceFileInfo[];
}

export interface PerfRunRepSource {
  scenarioId: string;
  repId: number;
  attemptId: number;
  /** Parsed result.json (PerfResult schemaVersion 2). Kept structural. */
  result: {
    schemaVersion: number;
    runId: string;
    repId: number;
    scenarioId: string;
    attemptId?: number;
    passType: string;
    status: string;
    trace?: { traceId?: string };
    git?: Array<{ repo: string; sha: string; dirty: boolean; branch?: string; remote?: string }>;
    environment?: Record<string, unknown>;
    metrics: Array<Record<string, unknown>>;
    artifacts: Array<Record<string, unknown>>;
    validations: Array<Record<string, unknown>>;
  };
  /** Run-root-relative rep directory, forward slashes (no trailing slash). */
  repDir: string;
  /** Rep start/end if known (from metrics/markers), else null. */
  startUnixNs?: string | null;
  endUnixNs?: string | null;
  warmup?: boolean;
}

export interface PerfRunSource {
  runId: string;
  passType: string;
  /** Run-level outcome from summary.json. */
  status: string;
  environmentHash: string;
  /** Derived by the loader: from runId prefix (second precision) or store. */
  createdAtUnixNs: string;
  /** Recomputed by the loader from run-config.snapshot.jsonc (verbatim text). */
  configHash: string;
  machineId?: string | null;
  notes?: string | null;
  /** Parsed environment.json. */
  environment: Record<string, unknown>;
  /** Scenario metadata from the loader's registry (or id-only fallback). */
  scenarios: Array<{
    scenarioId: string;
    displayName: string;
    owner?: string | null;
    tags?: unknown;
    definitionHash?: string | null;
  }>;
  reps: PerfRunRepSource[];
  /** Source inventory for the source digest + summary. */
  files: SourceFileInfo[];
}

export interface ProjectionOptions {
  uploadPolicyId: UploadPolicyId;
  /** Chunk size for diag_events items (default 1000 rows). */
  maxEventsPerItem?: number;
}

export class CentralProjectionError extends Error {
  constructor(
    message: string,
    public readonly reasonCode: string,
  ) {
    super(message);
    this.name = "CentralProjectionError";
  }
}

/** Throws when the projection contains policy refusals (writers call this before staging). */
export function assertUploadable(projection: CentralProjection): void {
  if (projection.preview.refused.length > 0) {
    const first = projection.preview.refused[0]!;
    throw new CentralProjectionError(
      `upload refused by policy '${projection.identity.uploadPolicyId}': ${first.field} (${first.cls}) ${first.reason}` +
        (projection.preview.refused.length > 1
          ? ` and ${projection.preview.refused.length - 1} more`
          : ""),
      "refusedByPolicy",
    );
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const DEFAULT_EVENTS_PER_ITEM = 1000;

class FieldNotes {
  private droppedByKey = new Map<string, UploadPreviewFieldNote>();
  private digestedByKey = new Map<string, UploadPreviewFieldNote>();
  readonly refused: UploadPreviewRefusal[] = [];
  readonly warnings: string[] = [];

  dropped(field: string, cls: DataClassification): void {
    bump(this.droppedByKey, field, cls);
  }
  digested(field: string, cls: DataClassification): void {
    bump(this.digestedByKey, field, cls);
  }
  refuse(field: string, cls: DataClassification, reason: string): void {
    this.refused.push({ field, cls, reason });
  }
  warn(message: string): void {
    if (!this.warnings.includes(message)) {
      this.warnings.push(message);
    }
  }
  droppedList(): UploadPreviewFieldNote[] {
    return [...this.droppedByKey.values()].sort((a, b) => (a.field < b.field ? -1 : 1));
  }
  digestedList(): UploadPreviewFieldNote[] {
    return [...this.digestedByKey.values()].sort((a, b) => (a.field < b.field ? -1 : 1));
  }
}

function bump(map: Map<string, UploadPreviewFieldNote>, field: string, cls: DataClassification) {
  const key = `${field}|${cls}`;
  const existing = map.get(key);
  if (existing) {
    existing.count++;
  } else {
    map.set(key, { field, cls, count: 1 });
  }
}

/** Contract-owned re-digest for values the upload policy digests (addendum §5). */
export function fieldDigest(cls: DataClassification, value: unknown): string {
  return digestCanonical("field", { cls, v: value === undefined ? null : value });
}

/** entity.id values already in digest form pass through (addendum C-4). */
export function isDigestForm(id: string): boolean {
  return (
    /^(uri:)?sha256:[0-9a-f]{16,64}$/i.test(id) || /^[a-z]{2,4}_[A-Za-z0-9_-]{16,43}$/.test(id)
  );
}

function unixNsToUtcIso(ns: string): string {
  return new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();
}

function epochMsToUtcIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** Windows-drive, UNC, or rooted paths are absolute; also reject traversal. */
export function isUnsafePath(p: string): boolean {
  return (
    /^[a-zA-Z]:[\\/]/.test(p) ||
    p.startsWith("\\\\") ||
    p.startsWith("/") ||
    p.startsWith("\\") ||
    p.split(/[\\/]/).includes("..")
  );
}

function toItems(
  kind: UploadItemKind,
  rows: unknown[],
  chunkSize: number,
  startOrdinal: number,
): UploadItemPayload[] {
  const items: UploadItemPayload[] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const payloadJson = canonicalJson(chunk);
    items.push({
      item_kind: kind,
      item_ordinal: startOrdinal + items.length,
      row_count: chunk.length,
      payload_digest: digestString("payload", payloadJson),
      payload_json: payloadJson,
    });
  }
  return items;
}

function buildProjection(args: {
  kind: "perfRun" | "diagSession";
  naturalKey: string;
  sourceSchemaVersion: string;
  policy: UploadPolicy;
  sourceDigest: string;
  content: unknown;
  itemsByKind: Array<[UploadItemKind, unknown[], number]>;
  notes: FieldNotes;
  sourceSummary: UploadPreview["sourceSummary"];
}): CentralProjection {
  const contentDigest = digestCanonical("content", args.content);
  let ordinal = 0;
  const items: UploadItemPayload[] = [];
  for (const [kind, rows, chunkSize] of args.itemsByKind) {
    if (rows.length === 0) {
      continue;
    }
    const kindItems = toItems(kind, rows, chunkSize, ordinal);
    ordinal += kindItems.length;
    items.push(...kindItems);
  }
  const projectionDigest = digestCanonical(
    "projection",
    items.map((i) => ({ k: i.item_kind, o: i.item_ordinal, p: i.payload_digest })),
  );
  const tables = new Map<string, { rows: number; bytes: number }>();
  for (const item of items) {
    const t = tables.get(item.item_kind) ?? { rows: 0, bytes: 0 };
    t.rows += item.row_count;
    t.bytes += Buffer.byteLength(item.payload_json, "utf8");
    tables.set(item.item_kind, t);
  }
  const preview: UploadPreview = {
    contractVersion: CENTRAL_CONTRACT_VERSION,
    projectorVersion: CENTRAL_PROJECTOR_VERSION,
    sourceKind: args.kind,
    naturalKey: args.naturalKey,
    uploadPolicyId: args.policy.policyId,
    sourceDigest: args.sourceDigest,
    contentDigest,
    projectionDigest,
    sourceSummary: args.sourceSummary,
    tables: [...tables.entries()]
      .map(([name, t]) => ({ name, rows: t.rows, bytesEstimate: t.bytes }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
    dropped: args.notes.droppedList(),
    digested: args.notes.digestedList(),
    refused: args.notes.refused,
    warnings: args.notes.warnings,
  };
  return {
    kind: args.kind,
    naturalKey: args.naturalKey,
    identity: {
      contractVersion: CENTRAL_CONTRACT_VERSION,
      projectorVersion: CENTRAL_PROJECTOR_VERSION,
      sourceSchemaVersion: args.sourceSchemaVersion,
      uploadPolicyId: args.policy.policyId,
    },
    sourceDigest: args.sourceDigest,
    contentDigest,
    projectionDigest,
    previewDigest: digestCanonical("preview", preview),
    preview,
    items,
  };
}

// ---------------------------------------------------------------------------
// Classified-payload policy application (diag events; addendum §5)
// ---------------------------------------------------------------------------

function applyPolicyToPayload(
  payload: Record<string, ClassifiedValueShape> | undefined,
  policy: UploadPolicy,
  notes: FieldNotes,
  fieldPrefix: string,
): { filtered: Record<string, ClassifiedValueShape>; maxCls: DataClassification } {
  const filtered: Record<string, ClassifiedValueShape> = {};
  let maxCls: DataClassification = "public";
  if (!payload) {
    return { filtered, maxCls };
  }
  for (const key of Object.keys(payload).sort()) {
    const field = payload[key]!;
    const action = policy.rules[field.cls] ?? "drop";
    if (action === "refuse") {
      // Refusal is for VALUES that must never cross. A capture-side redacted/
      // omitted/tokenized/digested marker carries no secret — it drops quietly
      // (addendum §5: non-plain handling passes the boundary untouched; we go
      // one step further and never ship secret-class fields at all).
      if (field.handling === "plain" || field.handling === "truncated") {
        notes.refuse(`${fieldPrefix}.${key}`, field.cls, "classProhibited");
      } else {
        notes.dropped(`${fieldPrefix}.${key}`, field.cls);
      }
      continue;
    }
    if (action === "drop") {
      notes.dropped(`${fieldPrefix}.${key}`, field.cls);
      continue;
    }
    let out: ClassifiedValueShape = field;
    if (action === "digest" && field.handling === "plain") {
      out = {
        cls: field.cls,
        handling: "digest",
        digest: fieldDigest(field.cls, field.v ?? null),
        ...(typeof field.v === "string" ? { len: field.v.length } : {}),
      };
      notes.digested(`${fieldPrefix}.${key}`, field.cls);
    } else if (typeof out.v === "string") {
      const sanitized = sanitizePayloadString(out.v);
      if (sanitized.changed) {
        out = { ...out, v: sanitized.value, handling: "truncated", len: out.v.length };
      }
    }
    filtered[key] = out;
    maxCls = maxClassification(maxCls, field.cls);
  }
  return { filtered, maxCls };
}

// ---------------------------------------------------------------------------
// Diagnostic session projection
// ---------------------------------------------------------------------------

export function projectDiagSession(
  source: DiagSessionSource,
  options: ProjectionOptions,
): CentralProjection {
  const policy = getUploadPolicy(options.uploadPolicyId);
  const notes = new FieldNotes();
  const manifest = source.manifest;

  if (!policy.allowedKinds.includes("diagSession")) {
    notes.refuse("session", "diagnostic.metadata", "kindProhibitedByPolicy");
  }
  if (manifest.status === "active") {
    notes.warn("session manifest is 'active'; v1 uploads require closed/partial (C-6)");
  }

  // Source digest: the pre-policy manifest inventory (C-1). Identical for both
  // writers without reading payload bodies — the manifest vouches for them.
  const sourceDigest = digestCanonical("source", {
    kind: "diagSession",
    schemaVersion: manifest.schemaVersion,
    sessionId: manifest.sessionId,
    eventCount: manifest.eventCount,
    gapCount: manifest.gapCount,
    segments: manifest.segments,
    sizeBytes: manifest.sizeBytes ?? null,
    droppedRanges: manifest.droppedRanges ?? [],
  });

  // Provenance is policy-filtered like everything else (C-7).
  const provenance: Record<string, unknown> = {};
  const prov = manifest.provenance as Record<string, unknown>;
  for (const key of Object.keys(PROVENANCE_FIELD_RULES).sort()) {
    const rule = PROVENANCE_FIELD_RULES[key]!;
    const raw = prov[key];
    if (raw === undefined || raw === null) {
      continue;
    }
    const action = rule.actions[options.uploadPolicyId];
    if (action === "keep") {
      provenance[key] = raw;
    } else if (action === "digest") {
      provenance[key] = fieldDigest(rule.cls, raw);
      notes.digested(`provenance.${key}`, rule.cls);
    } else {
      notes.dropped(`provenance.${key}`, rule.cls);
    }
  }
  for (const key of Object.keys(prov)) {
    if (!(key in PROVENANCE_FIELD_RULES)) {
      notes.dropped(`provenance.${key}`, "unknown");
    }
  }

  const eventRows: CentralDiagEventRow[] = [];
  const gapRows: CentralDiagGapRow[] = [];
  const contentEvents: unknown[] = [];
  const seenGapSpans = new Set<string>();

  for (const segment of source.segments) {
    for (const line of segment.lines) {
      if (isGapRecord(line)) {
        gapRows.push(gapRowFrom(line));
        seenGapSpans.add(`${line.fromSeq}|${line.throughSeq}`);
        continue;
      }
      const event = line as DiagEventShape;
      const { filtered, maxCls } = applyPolicyToPayload(
        event.payload,
        policy,
        notes,
        `event.payload`,
      );

      // Entity anchor (C-4): digest-form ids pass; anything else is treated as
      // source.path-class and follows the policy for that class.
      let entityKind: string | null = null;
      let entityRef: string | null = null;
      if (event.entity) {
        entityKind = event.entity.kind;
        if (isDigestForm(event.entity.id)) {
          entityRef = event.entity.id;
        } else {
          const action = policy.rules["source.path"];
          if (action === "keep") {
            entityRef = event.entity.id;
          } else {
            entityRef = fieldDigest("source.path", event.entity.id);
            notes.digested("event.entity.id", "source.path");
          }
        }
      }

      const payloadJson = canonicalJson(filtered);
      // cls_max reflects what is IN the stored row (post-policy); the
      // capture-side redaction count is preserved separately.
      const clsMax = maxCls;
      eventRows.push({
        seq: event.seq,
        event_id: event.eventId,
        epoch_ms: event.epochMs,
        event_time_utc: epochMsToUtcIso(event.epochMs),
        monotonic_ns: event.monotonicNs ?? null,
        process: event.process,
        pid: event.pid ?? null,
        feature: event.feature,
        kind: event.kind,
        type: event.type,
        status: event.status,
        trace_id: event.traceId ?? null,
        cause_event_id: event.causeEventId ?? null,
        entity_kind: entityKind,
        entity_ref: entityRef,
        duration_ms: event.durationMs ?? null,
        timing_class: event.timingClass ?? null,
        cls_max: clsMax,
        cls_rank: clsRank(clsMax),
        cls_redacted_fields: event.cls?.redactedFields ?? 0,
        tags_json: event.tags && event.tags.length > 0 ? canonicalJson(event.tags) : null,
        payload_json: payloadJson,
        payload_digest: digestString("payload", payloadJson),
      });
      contentEvents.push({ seq: event.seq, id: event.eventId, p: filtered });
    }
  }

  // Manifest droppedRanges become synthesized gap rows unless a journal
  // GapRecord already covers the identical span (C-5).
  for (const range of manifest.droppedRanges ?? []) {
    const span = `${range.fromSeq}|${range.throughSeq}`;
    if (seenGapSpans.has(span)) {
      continue;
    }
    seenGapSpans.add(span);
    gapRows.push({
      gap_id: `range:${range.fromSeq}`,
      from_seq: range.fromSeq,
      through_seq: range.throughSeq,
      dropped_count: range.throughSeq - range.fromSeq + 1,
      reason: "sinkOverflow",
      backfill_status: "notStarted",
      first_available_seq: null,
      epoch_ms: 0,
      gap_time_utc: epochMsToUtcIso(0),
    });
  }
  eventRows.sort((a, b) => a.seq - b.seq);
  gapRows.sort((a, b) => a.from_seq - b.from_seq || (a.gap_id < b.gap_id ? -1 : 1));

  if (eventRows.length !== manifest.eventCount) {
    notes.warn(
      `manifest eventCount=${manifest.eventCount} but ${eventRows.length} events projected (partial segment?)`,
    );
  }

  const productSha =
    typeof provenance["commit"] === "string" ? (provenance["commit"] as string) : null;
  const environmentHash =
    typeof provenance["environmentHash"] === "string"
      ? (provenance["environmentHash"] as string)
      : null;

  const sessionRow: CentralDiagSessionRow = {
    session_id: manifest.sessionId,
    source: manifest.source,
    capture_mode: manifest.captureMode,
    capture_policy_id: manifest.policyId,
    created_utc: manifest.createdUtc,
    updated_utc: manifest.updatedUtc,
    event_count: eventRows.length,
    gap_count: gapRows.length,
    source_size_bytes: manifest.sizeBytes ?? null,
    provenance_json: canonicalJson(provenance),
    environment_hash: environmentHash,
    product_sha: productSha,
    status: manifest.status,
  };

  const totalBytes = source.files.reduce((sum, f) => sum + f.sizeBytes, 0);
  return buildProjection({
    kind: "diagSession",
    naturalKey: manifest.sessionId,
    sourceSchemaVersion: manifest.schemaVersion,
    policy,
    sourceDigest,
    content: {
      kind: "diagSession",
      sessionId: manifest.sessionId,
      provenance,
      events: contentEvents,
      gaps: gapRows.map((g) => ({ id: g.gap_id, f: g.from_seq, t: g.through_seq })),
    },
    itemsByKind: [
      ["diag_sessions", [sessionRow], 1],
      ["diag_events", eventRows, options.maxEventsPerItem ?? DEFAULT_EVENTS_PER_ITEM],
      ["diag_gaps", gapRows, DEFAULT_EVENTS_PER_ITEM],
    ],
    notes,
    sourceSummary: {
      files: source.files.length,
      bytes: totalBytes,
      events: eventRows.length,
      gaps: gapRows.length,
    },
  });
}

function gapRowFrom(gap: GapRecordShape): CentralDiagGapRow {
  return {
    gap_id: gap.gapId,
    from_seq: gap.fromSeq,
    through_seq: gap.throughSeq,
    dropped_count: gap.droppedCount,
    reason: gap.reason,
    backfill_status: gap.backfillStatus,
    first_available_seq: gap.firstAvailableSeq ?? null,
    epoch_ms: gap.epochMs,
    gap_time_utc: epochMsToUtcIso(gap.epochMs),
  };
}

// ---------------------------------------------------------------------------
// Perf run projection (Tier 1)
// ---------------------------------------------------------------------------

function columnAction(column: string, policyId: UploadPolicyId): ColumnAction | undefined {
  return PERF_TWIN_COLUMN_RULES[column]?.actions[policyId];
}

export function projectPerfRun(
  source: PerfRunSource,
  options: ProjectionOptions,
): CentralProjection {
  const policy = getUploadPolicy(options.uploadPolicyId);
  const notes = new FieldNotes();

  if (!policy.allowedKinds.includes("perfRun")) {
    notes.refuse("run", "diagnostic.metadata", "kindProhibitedByPolicy");
  }

  const sourceDigest = digestCanonical("source", {
    kind: "perfRun",
    runId: source.runId,
    schemaVersion: 2,
    files: [...source.files]
      .map((f) => ({ path: f.relativePath, sha256: f.sha256 }))
      .sort((a, b) => (a.path < b.path ? -1 : 1)),
  });

  // runs row (subtraction list C-8: output_dir/config_path dropped by DDL —
  // they simply have no central column; machine_id/notes follow column rules).
  const machineAction = columnAction("runs.machine_id", options.uploadPolicyId) ?? "digest";
  let machineId: string | null = null;
  if (source.machineId) {
    if (machineAction === "keep") {
      machineId = source.machineId;
    } else if (machineAction === "digest") {
      machineId = fieldDigest("source.path", source.machineId);
      notes.digested("runs.machine_id", "source.path");
    } else {
      notes.dropped("runs.machine_id", "source.path");
    }
  }
  const notesAction = columnAction("runs.notes", options.uploadPolicyId) ?? "drop";
  let runNotes: string | null = null;
  if (source.notes) {
    if (notesAction === "keep") {
      const sanitized = sanitizePayloadString(source.notes);
      runNotes = sanitized.value;
    } else {
      notes.dropped("runs.notes", "user.text");
    }
  }

  const runRow: CentralRunRow = {
    run_id: source.runId,
    created_at_unix_ns: source.createdAtUnixNs,
    created_at_utc: unixNsToUtcIso(source.createdAtUnixNs),
    pass_type: source.passType as CentralRunRow["pass_type"],
    status: source.status as CentralRunRow["status"],
    config_hash: source.configHash,
    environment_hash: source.environmentHash,
    machine_id: machineId,
    notes: runNotes,
  };

  // Repositories: union across reps (identical by construction), sorted.
  const repoByName = new Map<string, CentralRunRepositoryRow>();
  for (const rep of source.reps) {
    for (const repo of rep.result.git ?? []) {
      repoByName.set(repo.repo, {
        run_id: source.runId,
        repo: repo.repo,
        sha: repo.sha,
        branch: repo.branch ?? null,
        dirty: repo.dirty ? 1 : 0,
        remote: repo.remote ?? null,
      });
    }
  }
  const repoRows = [...repoByName.values()].sort((a, b) => (a.repo < b.repo ? -1 : 1));

  const envRow = environmentRowFrom(source, options.uploadPolicyId, notes);

  const scenarioRows: CentralScenarioRow[] = [...source.scenarios]
    .sort((a, b) => (a.scenarioId < b.scenarioId ? -1 : 1))
    .map((s) => ({
      scenario_id: s.scenarioId,
      display_name: s.displayName,
      owner: s.owner ?? null,
      tags_json: s.tags !== undefined && s.tags !== null ? canonicalJson(s.tags) : null,
      definition_hash: s.definitionHash ?? null,
    }));

  const sortedReps = [...source.reps].sort(
    (a, b) =>
      (a.scenarioId < b.scenarioId ? -1 : a.scenarioId > b.scenarioId ? 1 : 0) ||
      a.repId - b.repId ||
      a.attemptId - b.attemptId,
  );

  const repRows: CentralRepetitionRow[] = [];
  const metricRows: CentralMetricRow[] = [];
  const validationRows: CentralValidationRow[] = [];
  const artifactRows: CentralArtifactRefRow[] = [];
  let metricCount = 0;

  for (const rep of sortedReps) {
    const r = rep.result;
    repRows.push({
      run_id: source.runId,
      scenario_id: rep.scenarioId,
      rep_id: rep.repId,
      attempt_id: rep.attemptId,
      status: r.status as CentralRepetitionRow["status"],
      warmup: rep.warmup ? 1 : 0,
      trace_id: r.trace?.traceId ?? null,
      start_unix_ns: rep.startUnixNs ?? null,
      end_unix_ns: rep.endUnixNs ?? null,
      start_utc: rep.startUnixNs ? unixNsToUtcIso(rep.startUnixNs) : null,
      end_utc: rep.endUnixNs ? unixNsToUtcIso(rep.endUnixNs) : null,
    });

    for (const m of r.metrics) {
      metricCount++;
      metricRows.push({
        run_id: source.runId,
        scenario_id: rep.scenarioId,
        rep_id: rep.repId,
        attempt_id: rep.attemptId,
        name: str(m["name"]) ?? "",
        value: num(m["value"]) ?? 0,
        unit: str(m["unit"]) ?? "",
        component: str(m["component"]) ?? "",
        process_role: str(m["processRole"]) ?? "",
        source: str(m["source"]) ?? "",
        official: m["official"] ? 1 : 0,
        lower_is_better: m["lowerIsBetter"] ? 1 : 0,
        aggregation: str(m["aggregation"]),
        trace_id: str(m["traceId"]),
        span_id: str(m["spanId"]),
        start_unix_ns: str(m["startUnixNs"]),
        end_unix_ns: str(m["endUnixNs"]),
        confidence: str(m["confidence"]),
        tags_json: m["tags"] !== undefined && m["tags"] !== null ? canonicalJson(m["tags"]) : null,
        derivation_json:
          m["derivation"] !== undefined && m["derivation"] !== null
            ? canonicalJson(m["derivation"])
            : null,
      });
    }

    for (const v of r.validations) {
      validationRows.push({
        run_id: source.runId,
        scenario_id: rep.scenarioId,
        rep_id: rep.repId,
        attempt_id: rep.attemptId,
        name: str(v["name"]) ?? "",
        status: (str(v["status"]) ?? "skipped") as CentralValidationRow["status"],
        message: str(v["message"]),
        details_json:
          v["details"] !== undefined && v["details"] !== null ? canonicalJson(v["details"]) : null,
      });
    }

    for (const a of r.artifacts) {
      const rawPath = str(a["path"]) ?? "";
      if (isUnsafePath(rawPath)) {
        notes.refuse("artifacts.path", "source.path", "absolutePath");
        continue;
      }
      const relative = `${rep.repDir}/${rawPath.replace(/\\/g, "/")}`;
      artifactRows.push({
        run_id: source.runId,
        scenario_id: rep.scenarioId,
        rep_id: rep.repId,
        attempt_id: rep.attemptId,
        kind: str(a["kind"]) ?? "",
        relative_path: relative,
        retention: (str(a["retention"]) ?? "always") as CentralArtifactRefRow["retention"],
        size_bytes: num(a["sizeBytes"]),
        sha256: str(a["sha256"]),
        content_type: str(a["contentType"]),
        created_at_unix_ns: null,
        created_at_utc: null,
      });
    }
  }

  const totalBytes = source.files.reduce((sum, f) => sum + f.sizeBytes, 0);
  return buildProjection({
    kind: "perfRun",
    naturalKey: source.runId,
    sourceSchemaVersion: "perf-result/2",
    policy,
    sourceDigest,
    content: {
      kind: "perfRun",
      runId: source.runId,
      run: runRow,
      environment: envRow,
      repos: repoRows,
      scenarios: scenarioRows,
      reps: repRows,
      metrics: metricRows,
      validations: validationRows,
      artifacts: artifactRows,
    },
    itemsByKind: [
      ["runs", [runRow], 1],
      ["run_repositories", repoRows, DEFAULT_EVENTS_PER_ITEM],
      ["environments", [envRow], 1],
      ["scenarios", scenarioRows, DEFAULT_EVENTS_PER_ITEM],
      ["repetitions", repRows, DEFAULT_EVENTS_PER_ITEM],
      ["metrics", metricRows, DEFAULT_EVENTS_PER_ITEM],
      ["validations", validationRows, DEFAULT_EVENTS_PER_ITEM],
      ["artifact_refs", artifactRows, DEFAULT_EVENTS_PER_ITEM],
    ],
    notes,
    sourceSummary: {
      files: source.files.length,
      bytes: totalBytes,
      metrics: metricCount,
    },
  });
}

function environmentRowFrom(
  source: PerfRunSource,
  policyId: UploadPolicyId,
  notes: FieldNotes,
): CentralEnvironmentRow {
  const env = source.environment;
  const os = rec(env["os"]);
  const cpu = rec(env["cpu"]);
  const memory = rec(env["memory"]);
  const vscode = rec(env["vscode"]);
  const sts = rec(env["sts"]);
  const sql = rec(env["sql"]);

  const machineAction = columnAction("environments.machine_id", policyId) ?? "digest";
  const rawMachine = str(env["machineId"]);
  let machineId: string | null = null;
  if (rawMachine) {
    if (machineAction === "keep") {
      machineId = rawMachine;
    } else if (machineAction === "digest") {
      machineId = fieldDigest("source.path", rawMachine);
      notes.digested("environments.machine_id", "source.path");
    } else {
      notes.dropped("environments.machine_id", "source.path");
    }
  }

  return {
    environment_hash: source.environmentHash,
    captured_at_unix_ns: str(env["capturedAtUnixNs"]) ?? source.createdAtUnixNs,
    captured_at_utc: unixNsToUtcIso(str(env["capturedAtUnixNs"]) ?? source.createdAtUnixNs),
    machine_id: machineId,
    os_platform: str(os["platform"]),
    os_version: str(os["version"]) ?? str(os["release"]),
    cpu_model: str(cpu["model"]),
    logical_cores: num(cpu["logicalCores"]),
    memory_total_mb: num(memory["totalMb"]),
    vscode_version: str(vscode["version"]),
    extension_versions_json:
      env["extensions"] !== undefined && env["extensions"] !== null
        ? canonicalJson(env["extensions"])
        : null,
    sts_version: str(sts["version"]),
    sql_image_digest: str(sql["imageDigest"]),
    sql_snapshot: str(sql["snapshot"]),
    config_fingerprint_json:
      env["config"] !== undefined && env["config"] !== null ? canonicalJson(env["config"]) : "{}",
  };
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
