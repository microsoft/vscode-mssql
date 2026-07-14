/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQL Data Plane — the domain API for connection/query semantics.
 *
 * Features (Query Studio, MetadataService, replay, perftest) import THIS
 * module only. A transport is bytes; a backend binding is semantics; this is
 * the domain contract every binding must honor (design doc 03 §3) or mark
 * unsupported through capabilities. STS2 JSON-RPC is the first binding —
 * its wire DTOs live under `src/services/sts2/` and never leak here.
 *
 * Privacy invariants (binding, not advisory): SQL text, result rows,
 * secrets, and tokens never enter adapter diagnostics; errors and
 * descriptors carry digests/metadata only.
 */

import type {
    SpatialColumnMetadata,
    VectorColumnMetadata,
} from "../../sharedInterfaces/queryResultCellCodec";

// ---------------------------------------------------------------------------
// Events (minimal local event shape — no vscode dependency so the domain core
// stays isomorphic for future web hosts).
// ---------------------------------------------------------------------------

export interface DataPlaneEvent<T> {
    (listener: (e: T) => void): { dispose(): void };
}

export interface DataPlaneDisposable {
    dispose(): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Profiles and auth (secrets by reference, never by value)
// ---------------------------------------------------------------------------

/**
 * Sanitized connection identity + secret PROVIDERS. Raw passwords/tokens must
 * only ever exist inside a binding's open-request closure.
 */
export interface SqlConnectionProfileRef {
    /** Stable digest for replay/metadata keys (never reversible). */
    profileFingerprint: string;
    server: string;
    database?: string;
    /** `aad` is a saved Entra profile; `bearer` is a caller-supplied token source. */
    authKind: "sql" | "integrated" | "aad" | "bearer";
    user?: string;
    encrypt?: string | boolean;
    trustServerCertificate?: boolean;
    /** Display-only label (safe). */
    displayName?: string;
    /** Profile accent for UI tinting (safe). */
    accentColor?: string;
}

export interface AuthProviderBundle {
    /** Resolves the password at open time; result never stored. */
    passwordProvider?: () => Promise<string | undefined>;
    /** Resolves a bearer/AAD token at open time (and on refresh). */
    tokenProvider?: () => Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// Availability and capabilities
// ---------------------------------------------------------------------------

export type DataPlaneAvailability =
    | { state: "unknown" }
    | { state: "available"; backend: string; capabilities: SqlBackendCapabilities }
    | { state: "unavailable"; backend: string; reason: string; retryable: boolean };

export interface SqlBackendCapabilities {
    protocolVersion?: string;
    streamingRows: boolean;
    creditBackpressure: boolean;
    cancel: boolean;
    dispose: boolean;
    oneActiveQueryPerSession: boolean;
    multipleResultSets: boolean;
    serverMessagesVerbatim: boolean;
    rowsAffectedStructured: boolean;
    executionPlanXml: boolean;
    estimatedPlan: boolean;
    actualPlan: boolean;
    typedCells: boolean;
    maxCellBytesHonored: boolean;
    pageRowsHonored: boolean;
    pageBytesHonored: boolean;
    queryTimeoutHonored: boolean;
    /** Backend can emit compact row pages (QO-5): no client-side page rebuild. */
    compactRows: boolean;
    /** Backend can emit typed vector cells for opted-in queries (D-0019). */
    vectorBinaryV1: boolean;
    /** Backend can emit complete typed geometry/geography WKB (D-0020). */
    spatialWkbV1: boolean;
    captureControl: boolean;
    replayDescriptors: boolean;
    resumeAfterDisconnect: boolean;
    metadataEndpoints?: boolean;
}

export interface BackendInfo {
    kind: string;
    displayName: string;
    version?: string;
}

// ---------------------------------------------------------------------------
// Canonical capability model (web-backend addendum §3.3 / TSQ2 addendum §3.2).
// One versioned registry; the boolean SqlBackendCapabilities struct above is a
// derived projection (see capabilityRegistry.ts). IDs are add-only.
// ---------------------------------------------------------------------------

export type SqlCapabilityId =
    // auth
    | "auth.sqlLogin"
    | "auth.entraToken"
    | "auth.integrated"
    | "auth.hostDelegated"
    // connectivity
    | "connect.tcp"
    | "connect.routeAlias"
    | "connect.localdb"
    | "connect.tds8Strict"
    // execution
    | "exec.streamingRows"
    | "exec.multipleResultSets"
    | "exec.oneActiveQuery"
    | "exec.cancel"
    | "exec.dispose"
    | "exec.queryTimeout"
    | "exec.compactRows"
    | "exec.maxCellBytes"
    | "exec.pageRows"
    | "exec.pageBytes"
    | "exec.windowPages"
    // types / fidelity
    | "types.typedCells"
    | "types.vectorBinaryV1"
    | "types.spatialWkbV1"
    | "types.decimalExact"
    | "types.datetimeOffsetOriginal"
    | "types.largeValueStreaming"
    | "types.jsonNative"
    // messages
    | "messages.verbatim"
    | "messages.rowsAffectedStructured"
    // plans (provider-side execution semantics only; graph parsing is a host capability)
    | "plan.xmlResult"
    | "plan.estimated"
    | "plan.actual"
    // metadata
    | "metadata.catalogSql"
    | "metadata.endpoints"
    // diagnostics
    | "diag.supportCapsule"
    | "diag.captureControl"
    | "diag.replayDescriptor"
    | "diag.resumeAfterDisconnect";

export type SqlCapabilitySupport = "supported" | "unsupported" | "conditional" | "degraded";

export type SqlCapabilityFidelity = "exact" | "normalized" | "lossy" | "notApplicable";

export interface SqlCapabilityValue {
    readonly support: SqlCapabilitySupport;
    readonly fidelity?: SqlCapabilityFidelity;
    readonly limit?: number;
    readonly unit?: "bytes" | "rows" | "pages" | "milliseconds" | "count";
    /** Stable, safe reason id (e.g. "driver.noIntegratedAuth"); never raw driver text. */
    readonly reasonCode?: string;
    readonly source: "static" | "handshake" | "route" | "session" | "probe";
}

export interface SqlCapabilitySet {
    readonly schemaVersion: 1;
    readonly values: Readonly<Partial<Record<SqlCapabilityId, SqlCapabilityValue>>>;
}

export type SqlCapabilityRequirement =
    | { readonly id: SqlCapabilityId; readonly require: "supported" }
    | { readonly id: SqlCapabilityId; readonly fidelityAtLeast: "exact" | "normalized" }
    | { readonly id: SqlCapabilityId; readonly minimum: number };

/** One unmet requirement, with the honest actual state and safe reason. */
export interface MissingCapability {
    readonly id: SqlCapabilityId;
    readonly actual?: SqlCapabilityValue;
    readonly reasonCode?: string;
}

export interface CapabilityCheck {
    ok: boolean;
    missing?: string[];
    /** Structured detail for the string ids in `missing` (additive; same order). */
    missingDetail?: readonly MissingCapability[];
    reason?: string;
    /** Backend kinds whose static statement satisfies the missing requirements. */
    alternatives?: readonly string[];
}

// ---------------------------------------------------------------------------
// Service and session
// ---------------------------------------------------------------------------

export interface OpenSessionParams {
    profile: SqlConnectionProfileRef;
    database?: string;
    applicationName: string;
    openTimeoutMs?: number;
    /** @deprecated Ignored — use `requiredCapabilities`. Removed after migration. */
    requestedCapabilities?: Partial<SqlBackendCapabilities>;
    /**
     * Hard requirements evaluated by canOpen/openSession BEFORE any credential
     * provider is invoked (TSQ2 §3.2). Absent = no extra requirement; every
     * listed requirement is mandatory.
     */
    requiredCapabilities?: readonly SqlCapabilityRequirement[];
    auth?: AuthProviderBundle;
}

export interface ISqlConnectionService {
    readonly availability: DataPlaneAvailability;
    readonly onDidChangeAvailability: DataPlaneEvent<DataPlaneAvailability>;
    readonly backendInfo?: BackendInfo;

    openSession(params: OpenSessionParams): Promise<ISqlSession>;
    canOpen(params: OpenSessionParams): Promise<CapabilityCheck>;
}

export interface SessionInfo {
    serverDisplayName?: string;
    serverVersion?: string;
    /** Edition DISPLAY name (serverproperty('Edition') — e.g. "SQL Azure"). */
    engineEdition?: string;
    /** Numeric serverproperty('EngineEdition') — 5 = Azure SQL DB, 8 = MI. */
    engineEditionId?: number;
    database?: string;
    loginName?: string;
    spid?: number;
    encrypted?: boolean;
    trustServerCertificate?: boolean;
    backendKind: string;
}

export type SessionState = "open" | "closing" | "closed" | "lost";

export interface SessionStateChange {
    previous: SessionState;
    current: SessionState;
    reason?: string;
}

export interface DatabaseContextChange {
    database: string;
    source: "backend" | "message" | "feature";
}

export interface CloseOptions {
    reason?: string;
    timeoutMs?: number;
}

export interface ISqlSession extends DataPlaneDisposable {
    readonly sessionId: string; // adapter-local
    readonly connectionId: string; // backend-assigned when available
    readonly info: SessionInfo;
    readonly capabilities: SqlBackendCapabilities;
    readonly state: SessionState;

    readonly onDidChangeState: DataPlaneEvent<SessionStateChange>;
    readonly onDidChangeDatabase: DataPlaneEvent<DatabaseContextChange>;
    /**
     * Record a database-context change the CLIENT caused (e.g. an explicit
     * USE it executed) so info/state and onDidChangeDatabase stay truthful.
     */
    signalDatabaseChanged(database: string, source: DatabaseContextChange["source"]): void;
    readonly onServerInfoMessage: DataPlaneEvent<ServerMessage>;

    execute(text: string, opts: ExecuteOptions, sink: IQueryEventSink): QueryHandle;
    close(opts?: CloseOptions): Promise<void>;
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export interface ExecuteOptions {
    pageRows?: number;
    pageBytes?: number;
    maxCellBytes?: number;
    /**
     * Request typed vector cells for this query (D-0019). Honored only when
     * the backend negotiated `vectorBinaryV1`; otherwise vector cells arrive
     * as JSON text (D-0018) and column metadata says `textFallback`.
     */
    vectorEncoding?: "binary-v1";
    /** Request complete typed SQL geometry/geography WKB for this query (D-0020). */
    spatialEncoding?: "wkb-v1";
    priority?: "interactive" | "background";
    /** Diag/replay label — metadata only, never SQL-derived text. */
    tag?: string;
    commandKind?: "user" | "metadata" | "plan" | "parse" | "replay" | "centralUpload";
    timeoutMs?: number;
    expectedDatabase?: string;
    catalogGeneration?: number;
}

export interface CancelAck {
    acknowledged: boolean;
    /** Honest state when the ack deadline expired. */
    uncertain?: boolean;
    reason?: string;
}

export type QueryCompletionStatus =
    | "succeeded"
    | "completedWithErrors"
    | "failed"
    | "canceled"
    | "disposed"
    | "connectionLost";

export interface QueryCompleteSummary {
    clientQueryId: string;
    status: QueryCompletionStatus;
    resultSetCount: number;
    totalRows: number;
    /** Structured when the backend provides it; else undefined. */
    rowsAffected?: number;
    errorCount: number;
    durationMs?: number;
    /** True when the adapter fabricated this terminal to preserve liveness. */
    synthesized?: boolean;
    /**
     * "unknown" when the provider lost its transport/driver before a
     * trustworthy terminal (TSQ2 §3.3): database side effects may have
     * occurred; consumers must never auto-retry the SQL.
     */
    outcomeCertainty?: "known" | "unknown";
    outcomeReason?: "transportLost" | "cancelUncertain" | "providerAborted";
    error?: SqlDataPlaneErrorInfo;
}

export interface QueryAccepted {
    clientQueryId: string;
    backendQueryId?: string;
}

/** Always-settled acceptance result (web addendum §3.4). */
export type QueryAcceptance =
    | {
          status: "accepted";
          clientQueryId: string;
          backendQueryId?: string;
          acceptedEpochMs: number;
      }
    | { status: "rejected"; clientQueryId: string; error: SqlDataPlaneErrorInfo }
    | { status: "aborted"; clientQueryId: string; reason: "caller" | "deadline" | "transport" };

export interface QueryHandle {
    readonly clientQueryId: string;
    /** @deprecated Compatibility during migration; prefer `accepted`. */
    readonly backendQueryId?: Promise<string>;
    /**
     * ALWAYS settles, exactly once: accepted, rejected (no stream events), or
     * aborted before submission. Providers settle this only after the driver
     * or wire accepts ownership of the request.
     */
    readonly accepted: Promise<QueryAcceptance>;
    /** ALWAYS settles — the feature-level liveness floor. */
    readonly completion: Promise<QueryCompleteSummary>;

    cancel(): Promise<CancelAck>;
    dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Event sink
// ---------------------------------------------------------------------------

export interface IQueryEventSink {
    onAccepted?(info: QueryAccepted): void | Promise<void>;
    onResultSetStarted(meta: ResultSetMetadata): void | Promise<void>;
    /** Resolution = durable acceptance; bindings ack backends only after it. */
    onRowsPage(page: RowsPage): void | Promise<void>;
    onMessage(msg: ServerMessage): void | Promise<void>;
    onResultSetEnded?(info: ResultSetEnded): void | Promise<void>;
    onPlan?(plan: PlanPayload): void | Promise<void>;
    onComplete(summary: QueryCompleteSummary): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Result model
// ---------------------------------------------------------------------------

export interface ColumnMetadata {
    ordinal: number;
    name: string;
    displayName: string;
    sqlType?: string;
    providerType?: string;
    allowNull?: boolean;
    precision?: number;
    scale?: number;
    maxLength?: number;
    isKey?: boolean;
    isXml?: boolean;
    isJson?: boolean;
    /**
     * Vector column facts (D-0018/D-0019): transport mode for THIS query plus
     * dimensions derived from wire length (8 + 4*dims). Metadata is a hint —
     * per-cell facts are authoritative for typed cells.
     */
    vector?: VectorColumnMetadata;
    /** Present only when this query negotiated typed spatial WKB. */
    spatial?: SpatialColumnMetadata;
}

export interface ResultSetMetadata {
    resultSetId: string;
    batchOrdinal: number;
    statementOrdinal?: number;
    columns: readonly ColumnMetadata[];
    isPlanResult?: boolean;
}

export interface ResultSetEnded {
    resultSetId: string;
    rowCount: number;
    truncatedReason?: string;
}

export interface TruncationInfo {
    originalBytes?: number;
    digest?: string;
    reason: "maxCellBytes" | "backendLimit" | "displayLimit";
}

export type CellValue =
    | { kind: "null" }
    | { kind: "string"; value: string; truncated?: TruncationInfo }
    | { kind: "number"; value: number | string; exact?: boolean }
    | { kind: "boolean"; value: boolean }
    | { kind: "datetime"; iso?: string; display: string }
    | {
          kind: "binary";
          base64?: string;
          hexPrefix?: string;
          byteLength?: number;
          truncated?: TruncationInfo;
      }
    | { kind: "xml" | "json"; value: string; truncated?: TruncationInfo }
    | { kind: "unsupported"; display: string; typeName?: string };

/**
 * Compact-page encoding of a byte-capped cell (ExecuteOptions.maxCellBytes):
 * the prefix the backend kept plus honest truncation metadata. Bindings place
 * this marker in CompactPage.values in place of the raw cell; decodeCell()
 * maps it to CellValue with `truncated` set. Webview display code detects the
 * same shape structurally (sharedInterfaces/queryStudioGridOps.ts stays
 * import-free by convention).
 */
export interface TruncatedCellEncoding {
    $t: "truncated";
    of: "string" | "binary";
    /** Full pre-truncation size in bytes. */
    bytes?: number;
    /** `sha256:<hex>` digest of the full value. */
    digest?: string;
    /** UTF-8 prefix (`of:"string"`) or base64-encoded prefix (`of:"binary"`). */
    v: string;
}

export function isTruncatedCellEncoding(raw: unknown): raw is TruncatedCellEncoding {
    return (
        raw !== null &&
        typeof raw === "object" &&
        (raw as { $t?: unknown }).$t === "truncated" &&
        typeof (raw as { v?: unknown }).v === "string"
    );
}

/**
 * Compact wire-faithful page encoding (addendum §3.3): full CellValue
 * materialization is LAZY (window-serve/serialize time). Bindings may deliver
 * this shape; RowStore retains it; tagged unions never cross postMessage.
 */
export interface CompactPage {
    /** Row-major display/raw values; null cells hold undefined. Byte-capped
     *  cells hold TruncatedCellEncoding markers. */
    values: unknown[][];
    /** Base64 packed bits, row-major (1 = NULL). */
    nullBitmap?: string;
    /** Per-column decode hints aligned with metadata ordinals. */
    typeHints?: string[];
}

export interface RowsPage {
    resultSetId: string;
    pageSeq: number;
    rowOffset: number;
    /** Compact encoding preferred; decode lazily via decodeCell(). */
    compact: CompactPage;
    rowCount: number;
    approxBytes: number;
    complete?: boolean;
}

export interface ServerMessage {
    kind: "info" | "warning" | "error";
    text: string;
    number?: number;
    severity?: number;
    state?: number;
    line?: number;
    procedure?: string;
    batchOrdinal?: number;
    statementOrdinal?: number;
    rowsAffected?: number;
    isDatabaseContextChange?: boolean;
    databaseName?: string;
}

export interface PlanPayload {
    planId: string;
    batchOrdinal?: number;
    statementOrdinal?: number;
    format: "showplanXml";
    xml: string;
    /** True when classified by heuristic rather than backend metadata. */
    heuristic?: boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface SqlDataPlaneErrorInfo {
    code: string;
    message: string;
    retryable: boolean;
    corr?: string;
    backend?: { kind: string; code?: string; diagnosticRef?: string };
    server?: {
        number?: number;
        severity?: number;
        state?: number;
        line?: number;
        procedure?: string;
    };
    synthesized?: boolean;
}

export class SqlDataPlaneError extends Error implements SqlDataPlaneErrorInfo {
    constructor(
        public readonly code: string,
        message: string,
        public readonly retryable: boolean = false,
        extras?: Partial<SqlDataPlaneErrorInfo>,
    ) {
        super(message);
        this.name = "SqlDataPlaneError";
        if (extras?.corr !== undefined) this.corr = extras.corr;
        if (extras?.backend !== undefined) this.backend = extras.backend;
        if (extras?.server !== undefined) this.server = extras.server;
        if (extras?.synthesized !== undefined) this.synthesized = extras.synthesized;
    }
    corr?: string;
    backend?: { kind: string; code?: string; diagnosticRef?: string };
    server?: {
        number?: number;
        severity?: number;
        state?: number;
        line?: number;
        procedure?: string;
    };
    synthesized?: boolean;
}

export const DataPlaneErrorCodes = {
    invalidRequest: "SqlDataPlane.InvalidRequest",
    busy: "SqlDataPlane.Busy",
    unavailable: "SqlDataPlane.Unavailable",
    auth: "SqlDataPlane.Auth",
    capabilityUnsupported: "SqlDataPlane.CapabilityUnsupported",
    policyDenied: "SqlDataPlane.PolicyDenied",
    resourceLimit: "SqlDataPlane.ResourceLimit",
    clientAborted: "SqlDataPlane.Client.Aborted",
    clientTimeout: "SqlDataPlane.Client.Timeout",
    protocolViolation: "SqlDataPlane.Client.ProtocolViolation",
    sinkError: "SqlDataPlane.Client.SinkError",
    transportClosed: "SqlDataPlane.Transport.Closed",
    transportBackpressure: "SqlDataPlane.Transport.Backpressure",
    providerInternal: "SqlDataPlane.Provider.Internal",
} as const;

// ---------------------------------------------------------------------------
// Replay descriptors (metadata only; text only under elevated capture)
// ---------------------------------------------------------------------------

export interface RequestDescriptor {
    descriptorVersion: 1;
    backendKind: string;
    sessionProfileFingerprint: string;
    database?: string;
    textDigest: string;
    /** Present only under elevated capture policy. */
    textRef?: string;
    options: ExecuteOptions;
    tag?: string;
    corr?: string;
    catalogGeneration?: number;
}

// ---------------------------------------------------------------------------
// Lazy cell decoding (the ONLY place compact → CellValue happens)
// ---------------------------------------------------------------------------

/** Reads bit `index` from a base64-packed row-major bitmap. */
export function bitmapHasBit(bitmapBase64: string | undefined, index: number): boolean {
    if (!bitmapBase64) {
        return false;
    }
    const byteIndex = index >> 3;
    // Buffer exists in the extension host; webviews never call this (they
    // receive the compact shape and render display values directly).
    const bytes = Buffer.from(bitmapBase64, "base64");
    if (byteIndex >= bytes.length) {
        return false;
    }
    return (bytes[byteIndex] & (1 << (index & 7))) !== 0;
}

/** Packs booleans (true = NULL) into a base64 row-major bitmap. */
export function packBitmap(bits: boolean[]): string {
    const bytes = Buffer.alloc(Math.ceil(bits.length / 8));
    for (let i = 0; i < bits.length; i++) {
        if (bits[i]) {
            bytes[i >> 3] |= 1 << (i & 7);
        }
    }
    return bytes.toString("base64");
}

/**
 * Decode one cell lazily from a compact page. Exactness rule (addendum
 * §3.3.3): out-of-range numerics arrive as strings from the binding and stay
 * `exact:false`-marked only when the binding actually lost the token.
 */
export function decodeCell(
    page: CompactPage,
    row: number,
    col: number,
    columnCount: number,
): CellValue {
    if (bitmapHasBit(page.nullBitmap, row * columnCount + col)) {
        return { kind: "null" };
    }
    const raw = page.values[row]?.[col];
    const hint = page.typeHints?.[col];
    if (raw === undefined || raw === null) {
        return { kind: "null" };
    }
    // Byte-capped cells decode BEFORE the hint switch — the String(raw)
    // fallbacks below would render the marker as "[object Object]".
    if (isTruncatedCellEncoding(raw)) {
        const truncated: TruncationInfo = {
            ...(raw.bytes !== undefined ? { originalBytes: raw.bytes } : {}),
            ...(raw.digest ? { digest: raw.digest } : {}),
            reason: "maxCellBytes",
        };
        if (raw.of === "binary") {
            return {
                kind: "binary",
                base64: raw.v,
                ...(raw.bytes !== undefined ? { byteLength: raw.bytes } : {}),
                truncated,
            };
        }
        return hint === "xml"
            ? { kind: "xml", value: raw.v, truncated }
            : { kind: "string", value: raw.v, truncated };
    }
    switch (hint) {
        case "number":
            return typeof raw === "number"
                ? { kind: "number", value: raw, exact: true }
                : { kind: "number", value: String(raw), exact: true };
        case "number:approx":
            return { kind: "number", value: String(raw), exact: false };
        case "boolean":
            return { kind: "boolean", value: raw === true || raw === 1 || raw === "1" };
        case "datetime":
            return { kind: "datetime", display: String(raw), iso: String(raw) };
        case "binary":
            return { kind: "binary", hexPrefix: String(raw) };
        case "xml":
            return { kind: "xml", value: String(raw) };
        case "json":
            return { kind: "json", value: String(raw) };
        default:
            return { kind: "string", value: String(raw) };
    }
}

/** Display string for a decoded cell (grid/text/export share this). */
export function cellDisplay(cell: CellValue): string {
    switch (cell.kind) {
        case "null":
            return "NULL";
        case "string":
        case "xml":
        case "json":
            return cell.value;
        case "number":
            return String(cell.value);
        case "boolean":
            return cell.value ? "1" : "0";
        case "datetime":
            return cell.display;
        case "binary":
            return cell.hexPrefix ?? (cell.base64 ? `0x${cell.base64.slice(0, 16)}…` : "0x…");
        case "unsupported":
            return cell.display;
    }
}
