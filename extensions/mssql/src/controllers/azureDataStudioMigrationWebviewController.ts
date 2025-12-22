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
    { id: "favorites", name: "Favorites", color: "#C94F4F", selected: true },
    { id: "production", name: "Production", color: "#025446", selected: true },
    { id: "experiments", name: "Experiments", color: "#3A78C2", selected: false },
    { id: "analytics", name: "Analytics", color: "#7D549C", selected: true },
    { id: "qa-ring", name: "QA Ring", color: "#A15C2F", selected: true },
    { id: "sandbox", name: "Sandbox", color: "#3FA7D6", selected: false },
    { id: "reporting", name: "Reporting", color: "#B1A214", selected: true },
    { id: "mission-critical", name: "Mission Critical", color: "#195E83", selected: true },
    { id: "prototypes", name: "Prototypes", color: "#D37AB6", selected: false },
    { id: "training", name: "Training", color: "#528C33", selected: false },
    { id: "partner-demos", name: "Partner Demos", color: "#6E3E6B", selected: true },
    { id: "retail", name: "Retail", color: "#C46B1A", selected: true },
    { id: "manufacturing", name: "Manufacturing", color: "#4F6E8F", selected: true },
    { id: "healthcare", name: "Healthcare", color: "#A3475C", selected: false },
    { id: "finance", name: "Finance", color: "#2F4858", selected: true },
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
        status: "ready",
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
        status: "ready",
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
        status: "needsAttention",
    },
    {
        id: "fabrikam-supply-chain",
        displayName: "Fabrikam Supply Chain",
        server: "fabrikam-supply.database.windows.net",
        database: "supplyChain",
        authenticationType: "Azure AD",
        userId: "sc-admin@fabrikam.com",
        groupId: "mission-critical",
        selected: true,
        status: "ready",
    },
    {
        id: "wingtip-retail-pos",
        displayName: "Wingtip Retail POS",
        server: "retail-pos.wingtip.com",
        database: "retailPOS",
        authenticationType: "SQL Login",
        userId: "pos_reader",
        groupId: "retail",
        selected: true,
        status: "needsAttention",
    },
    {
        id: "wideworld-importers",
        displayName: "Wide World Importers",
        server: "sql.wwi.azure.com",
        database: "importers",
        authenticationType: "Azure AD",
        userId: "warehouse.ops@wwi.com",
        groupId: "analytics",
        selected: true,
        status: "ready",
    },
    {
        id: "tailspin-training",
        displayName: "Tailspin Training",
        server: "training-db.tailspin.org",
        database: "trainingDB",
        authenticationType: "SQL Login",
        userId: "trainer",
        groupId: "training",
        selected: false,
        status: "needsAttention",
    },
    {
        id: "adventureworks-finance",
        displayName: "AdventureWorks Finance",
        server: "finance.awdatabase.net",
        database: "financeOps",
        authenticationType: "Azure AD",
        userId: "finance@adventureworks.com",
        groupId: "finance",
        selected: true,
        status: "ready",
    },
    {
        id: "northwind-reports",
        displayName: "Northwind Reports",
        server: "reports.northwind.com",
        database: "northwindReports",
        authenticationType: "SQL Login",
        userId: "reports_user",
        groupId: "reporting",
        selected: true,
        status: "ready",
    },
    {
        id: "consolidated-prototype",
        displayName: "Consolidated Prototype Lab",
        server: "proto-lab.contoso.net",
        authenticationType: "Integrated",
        groupId: "prototypes",
        selected: false,
        status: "needsAttention",
    },
    {
        id: "alpaca-qa-ring",
        displayName: "Project Alpaca QA",
        server: "qa-alpaca.internal",
        database: "alpacaQA",
        authenticationType: "Azure AD",
        userId: "qa@alpaca.ai",
        groupId: "qa-ring",
        selected: true,
        status: "ready",
    },
    {
        id: "sterling-health",
        displayName: "Sterling Health Data Lake",
        server: "sql.health.sterling.net",
        database: "sterlingHealth",
        authenticationType: "Azure AD",
        userId: "healthops@sterling.net",
        groupId: "healthcare",
        selected: false,
        status: "needsAttention",
    },
    {
        id: "northwind-partner-demo",
        displayName: "Northwind Partner Demo",
        server: "demo-partner.northwind.com",
        database: "demoDb",
        authenticationType: "SQL Login",
        userId: "demo_user",
        groupId: "partner-demos",
        selected: true,
        status: "needsAttention",
    },
    {
        id: "urban-sandbox",
        displayName: "Urban Research Sandbox",
        server: "urban-research.local",
        database: "urbanSandbox",
        authenticationType: "Integrated",
        groupId: "sandbox",
        selected: false,
        status: "needsAttention",
    },
    {
        id: "global-operations",
        displayName: "Global Operations Hub",
        server: "global-ops.fabric.azure.com",
        database: "globalOps",
        authenticationType: "Azure AD",
        userId: "operations@global.com",
        groupId: "mission-critical",
        selected: true,
        status: "ready",
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
