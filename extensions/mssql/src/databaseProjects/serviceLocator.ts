/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IExtension as IDataWorkspaceExtension } from "dataworkspace";
import type { MssqlInternalApi } from "../controllers/internalApiFactory";

let mssqlApi: MssqlInternalApi | undefined;
let dataWorkspaceApi: IDataWorkspaceExtension | undefined;

export function initializeDatabaseProjectsServices(
    internalApi: MssqlInternalApi,
    workspaceApi: IDataWorkspaceExtension,
): void {
    mssqlApi = internalApi;
    dataWorkspaceApi = workspaceApi;
}

export function getMssqlInternalApi(): MssqlInternalApi {
    if (!mssqlApi) {
        throw new Error("SQL Database Projects services have not been initialized");
    }
    return mssqlApi;
}

export function getDataWorkspaceApi(): IDataWorkspaceExtension {
    if (!dataWorkspaceApi) {
        throw new Error("Data Workspace services have not been initialized");
    }
    return dataWorkspaceApi;
}

/** Resets process-global state between extension-host test runs. */
export function resetDatabaseProjectsServices(): void {
    mssqlApi = undefined;
    dataWorkspaceApi = undefined;
}
