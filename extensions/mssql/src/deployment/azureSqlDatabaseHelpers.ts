/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FormItemOptions } from "../sharedInterfaces/form";
import { AzureSqlDatabaseState } from "../sharedInterfaces/azureSqlDatabase";
import { ApiStatus } from "../sharedInterfaces/webview";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent } from "../telemetry/telemetry";
import { DeploymentWebviewController } from "./deploymentWebviewController";

export async function initializeAzureSqlDatabaseState(
    groupOptions: FormItemOptions[],
    selectedGroupId: string | undefined,
): Promise<AzureSqlDatabaseState> {
    sendActionEvent(
        TelemetryViews.AzureSqlDatabase,
        TelemetryActions.StartAzureSqlDatabaseDeployment,
    );

    const state = new AzureSqlDatabaseState();
    state.formState = {
        accountId: "",
        tenantId: "",
        databaseName: "",
        groupId: selectedGroupId || groupOptions[0]?.value || "",
    };
    state.loadState = ApiStatus.Loaded;
    return state;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function registerAzureSqlDatabaseReducers(_controller: DeploymentWebviewController) {
    // No additional reducers for the skeleton deployment type
}

export function sendAzureSqlDatabaseCloseEventTelemetry(state: AzureSqlDatabaseState): void {
    sendActionEvent(
        TelemetryViews.AzureSqlDatabase,
        TelemetryActions.FinishAzureSqlDatabaseDeployment,
        {
            errorMessage: state.errorMessage || "",
        },
    );
}
