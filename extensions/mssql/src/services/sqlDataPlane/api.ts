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
    pageBytesHonored: boolean;
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

export interface CapabilityCheck {
    ok: boolean;
    missing?: string[];
    reason?: string;
}

// ---------------------------------------------------------------------------
// Service and session
// ---------------------------------------------------------------------------

export interface OpenSessionParams {
    profile: SqlConnectionProfileRef;
    database?: string;
    applicationName: string;
    openTimeoutMs?: number;
    requestedCapabilities?: Partial<SqlBackendCapabilities>;
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
    engineEdition?: string;
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
    priority?: "interactive" | "background";
    /** Diag/replay label — metadata only, never SQL-derived text. */
    tag?: string;
    commandKind?: "user" | "metadata" | "plan" | "parse" | "replay";
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
    error?: SqlDataPlaneErrorInfo;
}

export interface QueryAccepted {
    clientQueryId: string;
    backendQueryId?: string;
}

export interface QueryHandle {
    readonly clientQueryId: string;
    readonly backendQueryId?: Promise<string>;
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
    clientTimeout: "SqlDataPlane.Client.Timeout",
    protocolViolation: "SqlDataPlane.Client.ProtocolViolation",
    sinkError: "SqlDataPlane.Client.SinkError",
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
