/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Diagnostics hooks for the package.
 *
 * The package emits through this narrow interface rather than importing the extension's
 * DiagnosticsCore, so it stays free of vscode and stays unit-testable. The extension adapts
 * it onto DiagnosticsCore, where fields get their data classification and redaction.
 *
 * Every field is declared with a classification here too, so the adapter never has to guess
 * which values are safe to record. Anything derived from user data — SQL text, server names,
 * database names, login names, job names — is `sensitive`; counts and durations are `system`.
 */

/**
 * How a field must be treated on the way to a sink. These map one-to-one onto the extension's
 * DataClassification union, so the adapter never has to guess what a value contains.
 */
export type DataClass =
    | "system"
    | "serverName"
    | "databaseName"
    | "objectName"
    | "sqlText"
    | "userText";

export type DiagStatus = "ok" | "error" | "canceled";

/** A field plus how it must be treated on the way to a sink. */
export interface DiagField {
    readonly value: unknown;
    readonly cls: DataClass;
}

/** Counts, durations, identifiers we generate: safe to record as-is. */
export function sys(value: unknown): DiagField {
    return { value, cls: "system" };
}

export function serverName(value: unknown): DiagField {
    return { value, cls: "serverName" };
}

export function databaseName(value: unknown): DiagField {
    return { value, cls: "databaseName" };
}

/** Names a user chose: session names, job names, event session names. */
export function objectName(value: unknown): DiagField {
    return { value, cls: "objectName" };
}

/** Query text, which may embed literals from user data. */
export function sqlText(value: unknown): DiagField {
    return { value, cls: "sqlText" };
}

/** Free text such as a server error message. */
export function userText(value: unknown): DiagField {
    return { value, cls: "userText" };
}

export interface DiagEventInput {
    /** Dot-separated event name, e.g. "sqlDiag.dmv.run". */
    readonly type: string;
    readonly status?: DiagStatus;
    readonly durationMs?: number;
    readonly fields?: Readonly<Record<string, DiagField>>;
    /** Ties related events together across a single user action. */
    readonly traceId?: string;
}

export interface DiagSpanHandle {
    readonly traceId: string;
    end(status?: DiagStatus, fields?: Readonly<Record<string, DiagField>>): void;
    fail(error: unknown): void;
}

export interface DiagnosticsPort {
    emit(event: DiagEventInput): void;
    startSpan(type: string, fields?: Readonly<Record<string, DiagField>>): DiagSpanHandle;
}

/**
 * Event names this package emits. Declared in one place so the extension can register them
 * in the observability contract and so nothing emits an undeclared name by accident.
 */
export const SqlDiagEvents = {
    /** A catalog query ran (DMV, Query Store or Agent). */
    queryRun: "sqlDiag.query.run",
    /** A catalog query was refused before it ran, e.g. unsupported on this platform. */
    queryGated: "sqlDiag.query.gated",
    /** A cell arrived truncated. */
    cellTruncated: "sqlDiag.query.cellTruncated",
    /** An oversized cell was reassembled through fetch-back. */
    cellRefetched: "sqlDiag.query.cellRefetched",

    profilerSessionCreated: "sqlDiag.profiler.sessionCreated",
    profilerSessionStarted: "sqlDiag.profiler.sessionStarted",
    profilerSessionStopped: "sqlDiag.profiler.sessionStopped",
    profilerSessionDropped: "sqlDiag.profiler.sessionDropped",
    /** One dispatch buffer was decoded. */
    profilerBufferParsed: "sqlDiag.profiler.bufferParsed",
    /** A gap was detected in the event sequence: events the server produced never arrived. */
    profilerEventsLost: "sqlDiag.profiler.eventsLost",
    /** The live stream dropped and a reconnect was attempted. */
    profilerReconnect: "sqlDiag.profiler.reconnect",
    /** Sessions left behind by an earlier run were found on the server. */
    profilerOrphansFound: "sqlDiag.profiler.orphansFound",

    agentJobAction: "sqlDiag.agent.jobAction",
} as const;

/** A diagnostics port that discards everything, for tests and for callers that supply none. */
export const nullDiagnostics: DiagnosticsPort = {
    emit(): void {
        /* discarded */
    },
    startSpan(): DiagSpanHandle {
        return {
            traceId: "",
            end(): void {
                /* discarded */
            },
            fail(): void {
                /* discarded */
            },
        };
    },
};
