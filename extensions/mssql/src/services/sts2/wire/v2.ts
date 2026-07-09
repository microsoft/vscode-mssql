/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * STS2 wire contract v2 — AD-1 pinning against `sqltoolsservice/docs/sts2/
 * CONTRACT.md` + `CLIENT.md` + the Core reducer/driver sources (verified
 * 2026-07-04, spec 2.0.0-preview.1). This module is the ONLY place STS2 wire
 * DTOs exist; nothing outside `src/services/sts2/` may import it.
 *
 * Contract worksheet answers pinned here (addendum §6):
 *  #2  Ack = CLIENT NOTIFICATION `v2/query.ack`, per-page (`pageSeq`) or
 *      high-water (`throughPageSeq`). The binding uses high-water.
 *  #3  Dispose terminality = D-0011: every accepted query yields exactly one
 *      `v2/query.complete`; dispose of an active query yields
 *      status "disposed".
 *  #4  rowsAffected is STRUCTURED on `v2/query.complete` (number|number[]|null).
 *  #5  connection.open result carries serverInfo (product/version/
 *      engineEdition/dialect); SPID is NOT in the open result → probe path.
 *  #10 `v2/initialize {clientName, requestedSpecVersion}` → capabilities +
 *      limits (incl. windowPages backpressure window).
 *  Capture is `v2/diagnostics.setCapture` (NOT session.setCapture).
 *  #1  Verbatim messages: `v2/query.message` carries messageClass/number/
 *      severity/text as DATA — journal redaction is independent (SPEC §8.4).
 */

export const STS2_METHODS = {
    initialize: "v2/initialize",
    connectionOpen: "v2/connection.open",
    connectionCancel: "v2/connection.cancel",
    connectionClose: "v2/connection.close",
    queryExecute: "v2/query.execute",
    queryAck: "v2/query.ack",
    queryCancel: "v2/query.cancel",
    queryDispose: "v2/query.dispose",
    diagnosticsPing: "v2/diagnostics.ping",
    diagnosticsHealth: "v2/diagnostics.health",
    diagnosticsState: "v2/diagnostics.state",
    diagnosticsSetCapture: "v2/diagnostics.setCapture",
    // server notifications
    queryResultSet: "v2/query.resultSet",
    queryRows: "v2/query.rows",
    queryMessage: "v2/query.message",
    queryComplete: "v2/query.complete",
    fatal: "v2/fatal",
} as const;

/** Stable error identities live in error.data.code (JSON-RPC code is numeric). */
export const STS2_ERROR_CODES = {
    busy: "Sts2.Busy",
    canceled: "Sts2.Canceled",
    connectionFailedAuth: "Sts2.ConnectionFailed.Auth",
    connectionFailedNetwork: "Sts2.ConnectionFailed.Network",
    connectionFailedTimeout: "Sts2.ConnectionFailed.Timeout",
    internal: "Sts2.Internal",
    invalidRequest: "Sts2.InvalidRequest",
    notFound: "Sts2.NotFound",
    queryFailedServer: "Sts2.QueryFailed.Server",
    queryFailedTransport: "Sts2.QueryFailed.Transport",
    unavailable: "Sts2.Unavailable",
} as const;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface V2InitializeParams {
    clientName: string;
    requestedSpecVersion: string;
}

export interface V2InitializeResult {
    specVersion: string;
    serviceVersion?: string;
    capabilities?: Record<string, unknown>;
    limits?: { windowPages?: number; [key: string]: unknown };
    drivers?: string[];
    capture?: Record<string, unknown>;
    [key: string]: unknown;
}

/**
 * Wire profile. Secrets travel RAW inside `auth` — the service's
 * SecretRedactor tokenizes every auth field except kind/user BEFORE the
 * envelope/journal exists (SPEC §8.5); the client must still never log this
 * object (privacy canaries assert it).
 */
export interface V2ConnectionProfile {
    server: string;
    database?: string;
    driver: "sqlclient" | "sqlite";
    auth: {
        kind: "sqlLogin" | "accessToken" | "integrated";
        user?: string;
        password?: string;
        accessToken?: string;
    };
    options?: {
        applicationName?: string;
        connectTimeoutMs?: number;
        encrypt?: string;
        trustServerCertificate?: string;
        [key: string]: string | number | undefined;
    };
}

export interface V2ConnectionOpenParams {
    openId: string;
    profile: V2ConnectionProfile;
}

export interface V2ServerInfo {
    product?: string;
    version?: string;
    engineEdition?: string;
    dialect?: string;
}

export interface V2ConnectionOpenResult {
    connectionId: string;
    openId?: string;
    serverInfo?: V2ServerInfo;
    [key: string]: unknown;
}

export interface V2QueryExecuteParams {
    connectionId: string;
    sql: string;
    /**
     * Per-query bounds and timeout (SPEC §7.5, QO-3). Page limits and
     * `maxCellBytes` are lower-only (absent/0 = pinned service defaults; the
     * service never raises them); `queryTimeoutMs` 0/absent = provider
     * default. Capped cells arrive as truncated-cell markers (V2TruncatedCell).
     */
    options?: {
        pageRows?: number;
        pageBytes?: number;
        maxCellBytes?: number;
        queryTimeoutMs?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface V2QueryExecuteResult {
    queryId: string;
}

/** High-water ack (per-page `pageSeq` also accepted by the service). */
export interface V2QueryAckParams {
    queryId: string;
    throughPageSeq?: number;
    pageSeq?: number;
}

// ---------------------------------------------------------------------------
// Notifications (tolerant parsing: driver JSON casing may vary)
// ---------------------------------------------------------------------------

export interface V2WireColumn {
    name?: string;
    Name?: string;
    engineType?: string;
    EngineType?: string;
    nullable?: boolean | null;
    Nullable?: boolean | null;
}

export interface V2ResultSetNotification {
    queryId: string;
    resultSetId: number;
    columns: V2WireColumn[];
}

export interface V2RowsNotification {
    queryId: string;
    resultSetId: number;
    pageSeq: number;
    rowOffset: number;
    /** Cells: JSON scalars, null, or byte-capped V2TruncatedCell markers. */
    rows: unknown[][];
    last?: boolean;
}

/**
 * Byte-capped cell marker (service maxCellBytes semantics): the prefix the
 * service kept plus honest metadata about what it dropped. Tolerantly typed —
 * only `$t` is load-bearing for detection; the binding normalizes the rest.
 */
export interface V2TruncatedCell {
    $t: "truncated";
    of?: "string" | "binary" | string;
    /** Full pre-truncation size in bytes. */
    bytes?: number;
    /** `sha256:<hex>` digest of the full value. */
    digest?: string;
    /** UTF-8 prefix (`of:"string"`) or base64-encoded prefix (`of:"binary"`). */
    v?: string;
}

/** Detects the truncated-cell marker BEFORE any String() decode fallback. */
export function isV2TruncatedCell(cell: unknown): cell is V2TruncatedCell {
    return (
        cell !== null && typeof cell === "object" && (cell as { $t?: unknown }).$t === "truncated"
    );
}

export interface V2MessageNotification {
    queryId: string;
    messageClass: string; // "info" | "warning" | "error" (driver-defined)
    number?: number;
    severity?: number;
    text: string;
    line?: number;
}

export type V2QueryStatus = "succeeded" | "canceled" | "error" | "disposed";

export interface V2CompleteNotification {
    queryId: string;
    status: V2QueryStatus;
    rowsAffected: number | number[] | null;
    /** Connection's CURRENT database at completion (ENVCHANGE truth — reflects USE). */
    database?: string | null;
    error?: {
        code?: string;
        message?: string;
        server?: { number?: number; severity?: number; state?: number; line?: number } | null;
    };
}

export interface V2FatalNotification {
    reason?: string;
    journalPath?: string;
    [key: string]: unknown;
}

// --- helpers ----------------------------------------------------------------

export function wireColumnName(column: V2WireColumn): string {
    return column.name ?? column.Name ?? "";
}

export function wireColumnType(column: V2WireColumn): string | undefined {
    return column.engineType ?? column.EngineType;
}

export function wireColumnNullable(column: V2WireColumn): boolean | undefined {
    const value = column.nullable ?? column.Nullable;
    return value === null ? undefined : value;
}

/** Total rows affected from the structured complete payload. */
export function totalRowsAffected(value: number | number[] | null | undefined): number | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value === "number") {
        return value >= 0 ? value : undefined;
    }
    const total = value.filter((n) => n >= 0).reduce((a, b) => a + b, 0);
    return value.some((n) => n >= 0) ? total : undefined;
}

/** Stable Sts2.* identity from a JSON-RPC error object. */
export function sts2ErrorCode(error: unknown): string | undefined {
    return (error as { data?: { code?: string } } | undefined)?.data?.code;
}
