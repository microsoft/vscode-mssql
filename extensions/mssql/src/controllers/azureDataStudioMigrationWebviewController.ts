/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { AzureDataStudioMigration } from "../constants/locConstants";
import {
    AdsMigrationConnection,
    AdsMigrationConnectionGroup,
    AzureDataStudioMigrationBrowseForConfigRequest,
    AzureDataStudioMigrationWebviewState,
} from "../sharedInterfaces/azureDataStudioMigration";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import VscodeWrapper from "./vscodeWrapper";
import { sendActionEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";

const defaultConnectionGroups: AdsMigrationConnectionGroup[] = [
    {
        id: "favorites",
        name: "Favorites",
        color: "#C94F4F",
        selected: true,
    },
    {
        id: "production",
        name: "Production",
        color: "#025446",
        selected: true,
    },
    {
        id: "experiments",
        name: "Experiments",
        color: "#3A78C2",
        selected: false,
    },
];

const defaultConnections: AdsMigrationConnection[] = [
    {
        id: "contoso-payroll",
        displayName: "Contoso Payroll",
        server: "contoso-payroll.database.windows.net",
        database: "payroll",
        authenticationType: "Azure AD",
        userId: "payroll-admin@contoso.com",
        groupId: "production",
        selected: true,
    },
    {
        id: "fabric-telemetry",
        displayName: "Fabric Telemetry Warehouse",
        server: "fabric-sql.contoso.com",
        database: "telemetry",
        authenticationType: "Azure AD",
        userId: "telemetry@contoso.com",
        groupId: "favorites",
        selected: true,
    },
    {
        id: "edge-lab",
        displayName: "Edge Team Lab",
        server: "edge-dev.sql.contoso.local",
        database: "edgeSandbox",
        authenticationType: "SQL Login",
        userId: "edge_admin",
        groupId: "experiments",
        selected: false,
    },
];

const defaultState: AzureDataStudioMigrationWebviewState = {
    adsConfigPath: "",
    connectionGroups: defaultConnectionGroups,
    connections: defaultConnections,
};

export class AzureDataStudioMigrationWebviewController extends ReactWebviewPanelController<
    AzureDataStudioMigrationWebviewState,
    void
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        initialState: AzureDataStudioMigrationWebviewState = defaultState,
    ) {
        super(
            context,
            vscodeWrapper,
            "azureDataStudioMigration",
            "azureDataStudioMigration",
            initialState,
            {
                title: AzureDataStudioMigration.DocumentTitle,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", "connect_dark.svg"),
                    light: vscode.Uri.joinPath(context.extensionUri, "media", "connect_light.svg"),
                },
            },
        );

        this.initialize();
    }

    private initialize() {
        this.onRequest(AzureDataStudioMigrationBrowseForConfigRequest.type, async () => {
            const selection = await vscode.window.showOpenDialog({
                title: AzureDataStudioMigration.SelectConfigFileDialogTitle,
                openLabel: AzureDataStudioMigration.SelectConfigOpenLabel,
                canSelectFiles: true,
                canSelectMany: false,
                filters: {
                    JSON: ["json"],
                    Settings: ["settings", "settings.json"],
                },
            });

            const selectedPath = selection?.[0]?.fsPath;
            if (selectedPath) {
                const currentState = this.state ?? defaultState;
                this.state = {
                    ...currentState,
                    adsConfigPath: selectedPath,
                };
                sendActionEvent(
                    TelemetryViews.AzureDataStudioMigration,
                    TelemetryActions.Open,
                    {
                        action: "browseConfig",
                    },
                );
            }
            return selectedPath;
        });
    }
}
