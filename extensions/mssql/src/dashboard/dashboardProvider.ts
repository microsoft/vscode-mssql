/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlDashboard } from "../sharedInterfaces/sqlDashboard";

export interface DashboardProvider {
    readonly mode: SqlDashboard.WebviewState["mode"];
    readonly scenario?: SqlDashboard.MockScenario;
    readonly connection: SqlDashboard.WebviewState["connection"];
    load(route: SqlDashboard.Route, signal: AbortSignal): Promise<SqlDashboard.Page>;
    dispose(): void | Promise<void>;
}

export class DashboardProviderError extends Error {
    constructor(
        readonly code: string,
        readonly retryable: boolean,
        message: string,
    ) {
        super(message);
        this.name = "DashboardProviderError";
    }
}
