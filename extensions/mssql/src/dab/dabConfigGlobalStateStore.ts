/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "crypto";
import type * as vscode from "vscode";
import { Dab } from "../sharedInterfaces/dab";

const DAB_CONFIG_GLOBAL_STATE_PREFIX = "mssql.dab.config.v1";
const DAB_CONFIG_STORE_VERSION = 1;

interface StoredDabConfig {
    version: typeof DAB_CONFIG_STORE_VERSION;
    config: Dab.DabConfig;
}

/**
 * Persists one DAB configuration for a connection/database pair in extension global state.
 * The storage key contains only a hash; connection identifiers and database names are not stored.
 */
export class DabConfigGlobalStateStore {
    private readonly _storageKey: string;

    constructor(
        private readonly _globalState: vscode.Memento,
        connectionId: string,
        databaseName: string,
    ) {
        const normalizedDatabaseName = databaseName.trim().toLocaleLowerCase("en-US");
        const identityHash = createHash("sha256")
            .update(connectionId)
            .update("\0")
            .update(normalizedDatabaseName)
            .digest("hex");
        this._storageKey = `${DAB_CONFIG_GLOBAL_STATE_PREFIX}.${identityHash}`;
    }

    public get(): Dab.DabConfig | undefined {
        const stored = this._globalState.get<StoredDabConfig>(this._storageKey);
        if (stored?.version !== DAB_CONFIG_STORE_VERSION || !stored.config) {
            return undefined;
        }

        return stored.config;
    }

    public async set(config: Dab.DabConfig): Promise<void> {
        await this._globalState.update(this._storageKey, {
            version: DAB_CONFIG_STORE_VERSION,
            config,
        } satisfies StoredDabConfig);
    }
}
