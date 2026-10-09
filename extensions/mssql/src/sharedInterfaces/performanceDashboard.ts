/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc";

export interface PerformanceDashboardState {
    serverName: string;
    /** Empty for the login's default database. */
    databaseName: string;
}

export type PerformanceDashboardReducers = Record<string, never>;

export interface ListDatabasesResult {
    /** The online databases that the connection can see, by name. */
    readonly databases: readonly string[];
    /** Untranslated error text when the list could not be read. */
    readonly errorMessage?: string;
}

/** Lists the databases of the dashboard's server. */
export namespace ListDatabasesRequest {
    export const type = new RequestType<void, ListDatabasesResult, void>(
        "performanceDashboard/listDatabases",
    );
}

export interface SwitchDatabaseParams {
    readonly database: string;
}

export interface SwitchDatabaseResult {
    /**
     * True when the dashboard now shows the database. False when another open dashboard already
     * showed it, and that dashboard was revealed instead.
     */
    readonly switched: boolean;
}

/** Shows another database of the same server in the dashboard. */
export namespace SwitchDatabaseRequest {
    export const type = new RequestType<SwitchDatabaseParams, SwitchDatabaseResult, void>(
        "performanceDashboard/switchDatabase",
    );
}
