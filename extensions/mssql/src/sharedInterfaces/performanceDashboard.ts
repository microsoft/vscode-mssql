/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface PerformanceDashboardState {
    serverName: string;
    /** Empty for the login's default database. */
    databaseName: string;
}

export type PerformanceDashboardReducers = Record<string, never>;
