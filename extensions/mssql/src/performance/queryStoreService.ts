/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReadResult, SessionPurpose, SqlReader, errorResult } from "sql-core";
import { QueryStoreCapabilities, readQueryStoreCapabilities } from "sql-core/queryStore";
import ConnectionManager from "../controllers/connectionManager";
import { PrivatePreviewFeature, previewService } from "../previews/previewService";
import { SqlDataPlaneService } from "../services/sqlDataPlane/sqlDataPlaneService";
import {
    PerformanceRead,
    isPerformanceUnavailable,
} from "../sharedInterfaces/performanceDashboard";
import {
    ConnectionManagerPerformanceResolver,
    PerformanceConnectionResolver,
} from "./performanceConnections";
import {
    PerformanceDataPlaneHost,
    PerformanceSessionPool,
    unavailable,
} from "./performanceSessionPool";

/** A sql-core read against a database: its reader, and the capabilities of its server. */
export type QueryStoreOperation<T> = (
    reader: SqlReader,
    capabilities: QueryStoreCapabilities,
) => Promise<ReadResult<T>>;

/**
 * Runs sql-core Query Store reads and changes on dedicated SQL data plane sessions. It resolves
 * the saved profile, opens the session, and reads the capabilities of each connection and
 * database once.
 */
export class QueryStoreService implements vscode.Disposable {
    /**
     * Capabilities by connection identity and database, with the read session generation that
     * they were read on: a new session, such as after a failover or an upgrade, reads them again.
     */
    private readonly _capabilities = new Map<
        string,
        { readonly generation: number; readonly capabilities: Promise<QueryStoreCapabilities> }
    >();
    private _disposed = false;

    constructor(
        private readonly _resolver: PerformanceConnectionResolver,
        private readonly _pool: PerformanceSessionPool,
    ) {}

    /**
     * Runs an operation on the profile's database (or `database`). `change` operations run on a
     * session of their own. Returns why the database cannot be read when the data plane is off,
     * the profile is gone, or the session does not open.
     */
    async run<T>(
        profileId: string,
        database: string | undefined,
        operation: QueryStoreOperation<T>,
        purpose: SessionPurpose = "read",
    ): Promise<PerformanceRead<T>> {
        const blocked = this._disposed
            ? unavailable("dataPlaneUnavailable")
            : this._pool.availability();
        if (blocked) {
            return blocked;
        }
        const resolved = await this._resolver.resolve(profileId);
        if (isPerformanceUnavailable(resolved)) {
            return resolved;
        }
        const target = database ?? resolved.database;
        const session = this._pool.session(resolved.connection, target, purpose);
        const failure = await session.ensureOpen();
        if (failure) {
            return failure;
        }
        // The capabilities are read on the read session, which a change also opens, so they are
        // read again when that session is new.
        const readSession =
            purpose === "read" ? session : this._pool.session(resolved.connection, target, "read");
        const readFailure = readSession === session ? undefined : await readSession.ensureOpen();
        if (readFailure) {
            return readFailure;
        }
        let capabilities: QueryStoreCapabilities;
        try {
            capabilities = await this.capabilitiesFor(
                JSON.stringify([resolved.connection.serverFingerprint, target]),
                readSession.generation,
                () => readQueryStoreCapabilities(readSession),
            );
        } catch (error) {
            return errorResult(error);
        }
        try {
            return await operation(session, capabilities);
        } catch (error) {
            // A request that sql-core rejects, such as an ID that is not a bigint.
            return errorResult(error);
        }
    }

    dispose(): void {
        this._disposed = true;
        this._capabilities.clear();
        this._pool.dispose();
    }

    private capabilitiesFor(
        key: string,
        generation: number,
        read: () => Promise<QueryStoreCapabilities>,
    ): Promise<QueryStoreCapabilities> {
        const cached = this._capabilities.get(key);
        if (cached?.generation === generation) {
            return cached.capabilities;
        }
        const entry = { generation, capabilities: read() };
        this._capabilities.set(key, entry);
        // A failed read is not cached; the next call tries again.
        entry.capabilities.catch(() => {
            if (this._capabilities.get(key) === entry) {
                this._capabilities.delete(key);
            }
        });
        return entry.capabilities;
    }
}

export function createQueryStoreService(connectionManager: ConnectionManager): QueryStoreService {
    return new QueryStoreService(
        new ConnectionManagerPerformanceResolver(connectionManager),
        new PerformanceSessionPool(createDataPlaneHost()),
    );
}

/**
 * The data plane facts for the pool. SQL Tools Service starts the data plane only at startup, so
 * the settings are also read now, at activation, to tell a needed reload apart.
 */
export function createDataPlaneHost(): PerformanceDataPlaneHost {
    const isEnabled = () =>
        previewService.isPrivatePreviewEnabled(PrivatePreviewFeature.SqlDataPlane);
    const enabledAtActivation = isEnabled();
    return {
        isEnabled,
        wasEnabledAtActivation: () => enabledAtActivation,
        serviceForProfile: (profileFingerprint) =>
            SqlDataPlaneService.get().serviceForProfile(profileFingerprint),
    };
}
