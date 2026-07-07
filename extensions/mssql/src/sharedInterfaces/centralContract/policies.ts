/* GENERATED — do not edit. Source of truth: perftest/packages/perf-contracts/src/central/.
 * Re-vendor: copy the src/central/*.ts files here with this header (see
 * perf-contracts test/centralVendorSync.test.ts, which pins byte equality).
 * Contract central/1.0 — one projection implementation, two writers. */
/**
 * Upload-policy vocabulary for the central observability store (central
 * design §7, review addendum C-7/C-8, Appendix A/B).
 *
 * This file is the contract-owned source of truth for:
 *  - the DataClassification taxonomy (structural copy of the product union in
 *    vscode-mssql sharedInterfaces/debugConsole.ts — product-side vendor tests
 *    pin equality so the copies cannot drift);
 *  - the classification severity ladder RANK_ORDER (vendored verbatim from
 *    vscode-mssql diagnostics/redaction.ts, version "cls-rank/1") — never
 *    ORDER BY the class string; `secret` would sort before `sql.text`;
 *  - the named upload policies (allow/digest/drop/refuse per class);
 *  - the perf-twin column rules (Appendix A): per-column overrides that beat
 *    the class-level rule, including the local-only subtraction list.
 *
 * Capture policy controls what is collected locally; upload policy controls
 * what may leave the machine. The upload boundary re-applies classification
 * even when capture already did (base §7.1).
 */

// ---------------------------------------------------------------------------
// Classification taxonomy (structural copy — see header)
// ---------------------------------------------------------------------------

export type DataClassification =
  | "public"
  | "system.metadata"
  | "diagnostic.metadata"
  | "source.path"
  | "server.name"
  | "database.name"
  | "schema.name"
  | "object.name"
  | "sql.text"
  | "sql.digest"
  | "row.data"
  | "result.shape"
  | "secret"
  | "connection.string"
  | "token"
  | "user.text"
  | "model.prompt"
  | "model.response"
  | "unknown";

export type RedactionHandling =
  | "plain"
  | "redacted"
  | "digest"
  | "tokenized"
  | "truncated"
  | "omitted";

/** A payload field after capture-policy application (structural copy). */
export interface ClassifiedValueShape {
  v?: string | number | boolean | null;
  cls: DataClassification;
  handling: RedactionHandling;
  digest?: string;
  len?: number;
}

// ---------------------------------------------------------------------------
// Severity ladder (addendum Appendix B; vendored verbatim, "cls-rank/1")
// ---------------------------------------------------------------------------

export const RANK_TABLE_VERSION = "cls-rank/1";

/**
 * Deliberate quirks preserved from the source: `unknown` outranks
 * `model.response` but sits below `token`/`connection.string`/`secret`.
 */
export const RANK_ORDER: readonly DataClassification[] = [
  "public",
  "system.metadata",
  "diagnostic.metadata",
  "result.shape",
  "sql.digest",
  "source.path",
  "object.name",
  "schema.name",
  "database.name",
  "server.name",
  "user.text",
  "sql.text",
  "row.data",
  "model.prompt",
  "model.response",
  "unknown",
  "token",
  "connection.string",
  "secret",
];

/** rank(cls) = index in RANK_ORDER; unrecognized values rank past the end. */
export function clsRank(cls: string): number {
  const index = (RANK_ORDER as readonly string[]).indexOf(cls);
  return index < 0 ? RANK_ORDER.length : index;
}

export function maxClassification(
  a: DataClassification,
  b: DataClassification,
): DataClassification {
  return clsRank(b) > clsRank(a) ? b : a;
}

// ---------------------------------------------------------------------------
// Upload policies
// ---------------------------------------------------------------------------

/** What the upload boundary does with a field of a given class. */
export type PolicyAction = "keep" | "digest" | "drop" | "refuse";

export type CentralSourceKind = "perfRun" | "diagSession" | "featureTrace";

export type UploadPolicyId =
  | "team-default.v1"
  | "team-names.v1"
  | "elevated-support.v1"
  | "ci-official.v1";

export interface UploadPolicy {
  policyId: UploadPolicyId;
  description: string;
  /** Source kinds this policy may upload at all. */
  allowedKinds: readonly CentralSourceKind[];
  /** Class-level default actions; column rules (below) override these. */
  rules: Readonly<Record<DataClassification, PolicyAction>>;
}

function rules(
  overrides: Partial<Record<DataClassification, PolicyAction>>,
): Readonly<Record<DataClassification, PolicyAction>> {
  // Baseline shared by every policy: engineering evidence stays, payloads and
  // credentials never cross, secrets refuse loudly rather than drop silently.
  const base: Record<DataClassification, PolicyAction> = {
    public: "keep",
    "system.metadata": "keep",
    "diagnostic.metadata": "keep",
    "result.shape": "keep",
    "sql.digest": "keep",
    "source.path": "digest",
    "object.name": "digest",
    "schema.name": "digest",
    "database.name": "digest",
    "server.name": "digest",
    "user.text": "digest",
    "sql.text": "drop",
    "row.data": "drop",
    "model.prompt": "drop",
    "model.response": "drop",
    unknown: "drop",
    token: "drop",
    "connection.string": "drop",
    secret: "refuse",
  };
  return Object.freeze({ ...base, ...overrides });
}

export const UPLOAD_POLICIES: Readonly<Record<UploadPolicyId, UploadPolicy>> = Object.freeze({
  "team-default.v1": {
    policyId: "team-default.v1",
    description:
      "Internal engineering/dogfood default: shapes and digests only; metadata names digested; no SQL text, rows, prompts, credentials.",
    allowedKinds: ["perfRun", "diagSession"],
    rules: rules({}),
  },
  "team-names.v1": {
    policyId: "team-names.v1",
    description:
      "Trusted internal investigation where object names are necessary: metadata names and user notes plaintext; paths and machine labels still digested; same hard prohibitions.",
    allowedKinds: ["perfRun", "diagSession"],
    rules: rules({
      "object.name": "keep",
      "schema.name": "keep",
      "database.name": "keep",
      "server.name": "keep",
      "user.text": "keep",
    }),
  },
  "elevated-support.v1": {
    policyId: "elevated-support.v1",
    description:
      "Explicit support/investigation gesture: names, notes and paths plaintext; SQL text/rows/prompts remain excluded until a separate support policy is ratified; secrets always refused.",
    allowedKinds: ["perfRun", "diagSession", "featureTrace"],
    rules: rules({
      "object.name": "keep",
      "schema.name": "keep",
      "database.name": "keep",
      "server.name": "keep",
      "user.text": "keep",
      "source.path": "keep",
    }),
  },
  "ci-official.v1": {
    policyId: "ci-official.v1",
    description:
      "Official CI/perftest runs: metrics, validations, environment and repo facts; agent labels digested; user notes dropped; diagnostic session journals not uploadable under this policy.",
    allowedKinds: ["perfRun"],
    rules: rules({
      "user.text": "drop",
    }),
  },
});

export const DEFAULT_UPLOAD_POLICY_ID: UploadPolicyId = "team-default.v1";

// ---------------------------------------------------------------------------
// Perf-twin column rules (addendum Appendix A — binding for goldens)
// ---------------------------------------------------------------------------

/**
 * Column-level actions that OVERRIDE the class-level rule.
 *  - "drop": never uploaded under this policy;
 *  - "digest": uploaded as a digest;
 *  - "keep": uploaded plaintext;
 *  - "relativeOnly": path verified relative to the run root — absolute paths
 *    are a refusedByPolicy, not a silent digest (C-8/Q-3);
 *  - "uploaderFk": free-text identity replaced by the uploaders FK (C-8);
 *  - "localOnly": the table/column never crosses the boundary at all.
 */
export type ColumnAction =
  | "keep"
  | "digest"
  | "drop"
  | "relativeOnly"
  | "uploaderFk"
  | "localOnly";

export interface PerfTwinColumnRule {
  cls: DataClassification;
  actions: Readonly<Record<UploadPolicyId, ColumnAction>>;
}

function allPolicies(action: ColumnAction): Readonly<Record<UploadPolicyId, ColumnAction>> {
  return Object.freeze({
    "team-default.v1": action,
    "team-names.v1": action,
    "elevated-support.v1": action,
    "ci-official.v1": action,
  });
}

export const PERF_TWIN_COLUMN_RULES: Readonly<Record<string, PerfTwinColumnRule>> = Object.freeze(
  {
    "runs.output_dir": { cls: "source.path", actions: allPolicies("drop") },
    "runs.config_path": { cls: "source.path", actions: allPolicies("drop") },
    "repetitions.result_path": { cls: "source.path", actions: allPolicies("drop") },
    "runs.machine_id": {
      cls: "source.path",
      actions: Object.freeze({
        "team-default.v1": "digest" as ColumnAction,
        "team-names.v1": "keep" as ColumnAction,
        "elevated-support.v1": "keep" as ColumnAction,
        "ci-official.v1": "digest" as ColumnAction,
      }),
    },
    "environments.machine_id": {
      cls: "source.path",
      actions: Object.freeze({
        "team-default.v1": "digest" as ColumnAction,
        "team-names.v1": "keep" as ColumnAction,
        "elevated-support.v1": "keep" as ColumnAction,
        "ci-official.v1": "digest" as ColumnAction,
      }),
    },
    "runs.notes": {
      cls: "user.text",
      actions: Object.freeze({
        "team-default.v1": "drop" as ColumnAction,
        "team-names.v1": "keep" as ColumnAction,
        "elevated-support.v1": "keep" as ColumnAction,
        "ci-official.v1": "drop" as ColumnAction,
      }),
    },
    "baselines.notes": {
      cls: "user.text",
      actions: Object.freeze({
        "team-default.v1": "drop" as ColumnAction,
        "team-names.v1": "keep" as ColumnAction,
        "elevated-support.v1": "keep" as ColumnAction,
        "ci-official.v1": "drop" as ColumnAction,
      }),
    },
    "artifacts.path": { cls: "source.path", actions: allPolicies("relativeOnly") },
    "baselines.created_by": { cls: "user.text", actions: allPolicies("uploaderFk") },
    "comparisons.*": { cls: "diagnostic.metadata", actions: allPolicies("localOnly") },
    "comparison_metrics.*": { cls: "diagnostic.metadata", actions: allPolicies("localOnly") },
  },
);

// ---------------------------------------------------------------------------
// Provenance rules (addendum C-7): SessionManifest.provenance fields
// ---------------------------------------------------------------------------

export const PROVENANCE_FIELD_RULES: Readonly<
  Record<string, { cls: DataClassification; actions: Readonly<Record<UploadPolicyId, ColumnAction>> }>
> = Object.freeze({
  machineLabel: {
    cls: "source.path",
    actions: Object.freeze({
      "team-default.v1": "digest" as ColumnAction,
      "team-names.v1": "digest" as ColumnAction,
      "elevated-support.v1": "keep" as ColumnAction,
      "ci-official.v1": "digest" as ColumnAction,
    }),
  },
  extensionVersion: { cls: "system.metadata", actions: allPolicies("keep") },
  commit: { cls: "system.metadata", actions: allPolicies("keep") },
  dirty: { cls: "system.metadata", actions: allPolicies("keep") },
  environmentHash: { cls: "system.metadata", actions: allPolicies("keep") },
  vscodeVersion: { cls: "system.metadata", actions: allPolicies("keep") },
  stsVersion: { cls: "system.metadata", actions: allPolicies("keep") },
});

export function getUploadPolicy(policyId: string): UploadPolicy {
  const policy = (UPLOAD_POLICIES as Record<string, UploadPolicy>)[policyId];
  if (!policy) {
    throw new Error(`Unknown upload policy '${policyId}'`);
  }
  return policy;
}
