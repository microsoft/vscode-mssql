/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared multi-provider registry contracts (web addendum §3.1-3.2, TSQ2
 * addendum §3.1/§3.5). Provider identity is a tuple, not one enum string:
 * diagnostics, caching, policy, and perf treatments need the complete
 * composition. `backendKind` remains the product selector.
 *
 * No vscode import — the registry itself (sqlDataPlaneService.ts) injects
 * configuration through SqlBackendFactoryContext so factories stay testable
 * in plain Node.
 */

import { ISqlConnectionService, SqlCapabilitySet, SqlDataPlaneErrorInfo } from "./api";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type SqlBackendKind = "sts2-local" | "sts2-remote" | "ts-native" | "fake";

export type SqlProviderImplementation = "sts2" | "ts-native" | "fake";
export type SqlProviderTransport = "stdio-jsonrpc" | "wss-jsonrpc" | "inprocess";
export type SqlProviderDriver = "sqlclient" | "tedious" | "fake";
export type SqlProviderDeployment =
    | "extension-local"
    | "webhost-loopback"
    | "webhost-remote"
    | "test";

export interface SqlBackendIdentity {
    readonly kind: SqlBackendKind;
    readonly implementation: SqlProviderImplementation;
    readonly transport: SqlProviderTransport;
    readonly driver: SqlProviderDriver;
    readonly deployment: SqlProviderDeployment;
    /** Non-secret stable partition id ("local" for extension-local realms). */
    readonly realmId: string;
    readonly providerVersion: string;
    readonly protocolVersion?: string;
    readonly driverVersion?: string;
}

/**
 * Settings migration: `sts2-jsonrpc` is accepted as a read alias for
 * `sts2-local` only. It is never emitted as a new identity. Unknown values
 * return undefined — callers MUST fail typed, never fall back to local STS.
 */
export function normalizeBackendKind(raw: string | undefined): SqlBackendKind | undefined {
    switch (raw) {
        case undefined:
        case "":
        case "sts2-local":
        case "sts2-jsonrpc": // deprecated alias
            return "sts2-local";
        case "ts-native":
            return "ts-native";
        case "fake":
            return "fake";
        case "sts2-remote":
            return "sts2-remote";
        default:
            return undefined;
    }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Minimal config reader so factories never import vscode. */
export interface DataPlaneConfigReader {
    get<T>(section: string, defaultValue: T): T;
}

export interface SqlBackendFactoryContext {
    readonly config: DataPlaneConfigReader;
    /** Extension (provider) version stamped into identities. */
    readonly providerVersion: string;
}

export interface SqlBackendFactory {
    readonly kind: SqlBackendKind;
    readonly displayName: string;
    readonly realmClass: "local" | "remote" | "test";
    /**
     * Identity facts known WITHOUT loading the provider (driverVersion may be
     * refined after a lazy driver load).
     */
    readonly identity: SqlBackendIdentity;
    /**
     * T1 static capability statement — answerable with zero side effects,
     * before create(). Static answers must never optimistically claim
     * supported (TSQ2 §8.1); driver/server-dependent facts are `conditional`.
     */
    readonly staticCapabilities: SqlCapabilitySet;
    /**
     * Settings keys (absolute, e.g. "mssql.sqlDataPlane.timeouts.openMs")
     * whose values participate in this kind's config fingerprint; a change
     * recomposes only this entry.
     */
    readonly fingerprintSettings: readonly string[];
    create(context: SqlBackendFactoryContext): Promise<ISqlConnectionService>;
}

// ---------------------------------------------------------------------------
// Registry entry (exported for tests)
// ---------------------------------------------------------------------------

export type BackendEntryState = "idle" | "starting" | "running" | "failed" | "disposed";

export interface BackendEntrySnapshot {
    readonly kind: SqlBackendKind;
    readonly state: BackendEntryState;
    readonly displayName: string;
    readonly realmClass: "local" | "remote" | "test";
    readonly activeSessionCount: number;
    readonly configFingerprint: string;
    readonly staleConfig: boolean;
    readonly lastError?: SqlDataPlaneErrorInfo;
}
