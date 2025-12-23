/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import { homedir } from "os";
import { promises as fs } from "fs";
import stripJsonComments from "strip-json-comments";

import { AzureDataStudioMigration } from "../constants/locConstants";
import {
    AdsMigrationConnection,
    AdsMigrationConnectionGroup,
    AdsMigrationConnectionResolvedStatus,
    AdsMigrationConnectionStatus,
    AzureDataStudioMigrationBrowseForConfigRequest,
    AzureDataStudioMigrationWebviewState,
} from "../sharedInterfaces/azureDataStudioMigration";
import { AuthenticationType, IConnectionDialogProfile } from "../sharedInterfaces/connectionDialog";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import VscodeWrapper from "./vscodeWrapper";
import { sendActionEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { IConnectionGroup } from "../sharedInterfaces/connectionGroup";
import { getErrorMessage } from "../utils/utils";

const defaultState: AzureDataStudioMigrationWebviewState = {
    adsConfigPath: "",
    connectionGroups: [],
    connections: [],
    rootGroupIds: [],
};

export class AzureDataStudioMigrationWebviewController extends ReactWebviewPanelController<
    AzureDataStudioMigrationWebviewState,
    void
> {
    private existingConnectionIds: Set<string> = new Set<string>();
    private existingGroupIds: Set<string> = new Set<string>();

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

        this.registerRequestHandlers();
        void this.initialize();
    }

    private registerRequestHandlers() {
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
                await this.loadSettingsFromFile(selectedPath);
                sendActionEvent(TelemetryViews.AzureDataStudioMigration, TelemetryActions.Open, {
                    action: "browseConfig",
                });
            }
            return selectedPath;
        });
    }

    private async initialize() {
        // Attempt to load settings from the default ADS settings path
        const defaultPath = this.getDefaultAdsSettingsPath();
        if (!defaultPath) {
            return;
        }
        if (!(await this.fileExists(defaultPath))) {
            return;
        }
        await this.loadSettingsFromFile(defaultPath);
    }

    private getDefaultAdsSettingsPath(): string | undefined {
        const home = homedir();
        switch (process.platform) {
            case "win32":
                if (process.env.APPDATA) {
                    return path.join(
                        process.env.APPDATA,
                        "azuredatastudio",
                        "User",
                        "settings.json",
                    );
                }
                return home
                    ? path.join(
                          home,
                          "AppData",
                          "Roaming",
                          "azuredatastudio",
                          "User",
                          "settings.json",
                      )
                    : undefined;
            case "darwin":
                return path.join(
                    home,
                    "Library",
                    "Application Support",
                    "azuredatastudio",
                    "User",
                    "settings.json",
                );
            case "linux":
            default:
                return path.join(home, ".config", "azuredatastudio", "User", "settings.json");
        }
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    private async loadSettingsFromFile(filePath: string): Promise<void> {
        try {
            this.refreshExistingMssqlEntities();

            const raw = await fs.readFile(filePath, { encoding: "utf8" });
            const parsed = JSON.parse(stripJsonComments(raw)) as Record<string, unknown>;

            const { groups, rootGroupIds } = this.parseConnectionGroups(
                parsed?.["datasource.connectionGroups"],
            );
            const connections = this.parseConnections(parsed?.["datasource.connections"]);

            this.state = {
                adsConfigPath: filePath,
                connectionGroups: groups,
                connections,
                rootGroupIds,
            };
        } catch (error) {
            void vscode.window.showErrorMessage(
                `Failed to load Azure Data Studio settings: ${getErrorMessage(error)}`,
            );
        }
    }

    private parseConnectionGroups(value: unknown): {
        groups: AdsMigrationConnectionGroup[];
        rootGroupIds: string[];
    } {
        if (!Array.isArray(value)) {
            return {
                groups: [],
                rootGroupIds: [],
            };
        }

        const groups: AdsMigrationConnectionGroup[] = [];
        const rootGroupIds: string[] = [];
        for (const candidate of value) {
            const group = this.createGroup(candidate);
            if (group) {
                if (group.name?.trim().toUpperCase() === "ROOT") {
                    rootGroupIds.push(group.id);
                } else {
                    groups.push(group);
                }
            }
        }

        return { groups, rootGroupIds };
    }

    private createGroup(candidate: unknown): AdsMigrationConnectionGroup | undefined {
        if (!candidate || typeof candidate !== "object") {
            return undefined;
        }

        const record = candidate as Record<string, unknown>;
        const id = this.getString(record, ["id", "groupId"]);
        const name = this.getString(record, ["name", "groupName"]);
        if (!id || !name) {
            return undefined;
        }

        const group: IConnectionGroup = {
            id,
            name,
            parentId: this.getString(record, ["parentId"]),
            color: this.getString(record, ["color"]),
            description: this.getString(record, ["description"]),
        };

        const alreadyImported = this.existingGroupIds.has(group.id);

        return {
            ...group,
            selected: !alreadyImported,
            status: alreadyImported ? "alreadyImported" : "ready",
        };
    }

    private parseConnections(value: unknown): AdsMigrationConnection[] {
        if (!Array.isArray(value)) {
            return [];
        }

        const connections: AdsMigrationConnection[] = [];
        for (const entry of value) {
            const connection = this.createConnection(entry);
            if (connection) {
                connections.push(connection);
            }
        }

        return connections;
    }

    private createConnection(candidate: unknown): AdsMigrationConnection | undefined {
        if (!candidate || typeof candidate !== "object") {
            return undefined;
        }

        const record = candidate as Record<string, unknown>;
        const providerName =
            this.getString(record, ["providerName"]) ??
            this.getString(record.options as Record<string, unknown> | undefined, ["providerName"]);
        if (providerName && providerName.toLowerCase() !== "mssql") {
            return undefined;
        }

        const options =
            typeof record.options === "object" && record.options
                ? (record.options as Record<string, unknown>)
                : record;

        const server = this.getString(options, ["server"]) ?? "";
        const authenticationType =
            this.getString(options, ["authenticationType", "authType"]) ??
            AuthenticationType.SqlLogin;
        const database = this.getString(options, ["database"]) ?? "";
        const user = this.getString(options, ["user", "userName"]) ?? "";
        const profileName =
            this.getString(options, ["connectionName", "name", "profileName"]) ?? server;

        const fallbackId =
            this.getString(record, ["id", "connectionId"]) ??
            profileName ??
            (server ||
                `ads-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

        const profile: IConnectionDialogProfile = {
            profileName,
            server,
            database,
            authenticationType,
            user,
            password: "",
            email: undefined,
            accountId: undefined,
            tenantId: undefined,
            port: typeof options.port === "number" ? options.port : 0,
            groupId:
                this.getString(record, ["groupId", "groupIdName", "group"]) ??
                this.getString(options, ["groupId"]) ??
                "",
            azureAuthType: undefined,
            savePassword: Boolean(options.savePassword),
            emptyPasswordInput: false,
            id: fallbackId,
        } as IConnectionDialogProfile;

        let issue: AdsMigrationConnection["issue"];
        let status: AdsMigrationConnectionStatus = "ready";
        if (
            !profile.server ||
            (profile.authenticationType === AuthenticationType.SqlLogin && !profile.user)
        ) {
            status = "needsAttention";
            issue = "missingCredentials";
        }

        let resolvedStatus: AdsMigrationConnectionResolvedStatus = status;
        if (this.existingConnectionIds.has(profile.id)) {
            resolvedStatus = "alreadyImported";
        }

        return {
            profile,
            issue,
            selected: resolvedStatus !== "alreadyImported",
            status: resolvedStatus,
        };
    }

    private getString(
        source: Record<string, unknown> | undefined,
        keys: string[],
    ): string | undefined {
        if (!source) {
            return undefined;
        }
        for (const key of keys) {
            const value = source[key];
            if (typeof value === "string" && value.trim().length > 0) {
                return value;
            }
        }
        return undefined;
    }

    private refreshExistingMssqlEntities(): void {
        const config = vscode.workspace.getConfiguration("mssql");

        this.existingConnectionIds = this.collectIdsFromInspect<IConnectionDialogProfile>(
            config.inspect<IConnectionDialogProfile[]>("connections"),
        );
        this.existingGroupIds = this.collectIdsFromInspect<IConnectionGroup[]>(
            config.inspect<IConnectionGroup[]>("connectionGroups"),
        );
    }

    private collectIdsFromInspect<T extends { id?: string }>(
        inspectResult: vscode.ConfigurationInspect<T[]> | undefined,
    ): Set<string> {
        const ids = new Set<string>();
        if (!inspectResult) {
            return ids;
        }

        const addEntries = (entries?: T[] | null) => {
            if (!Array.isArray(entries)) {
                return;
            }
            for (const entry of entries) {
                if (entry && typeof entry === "object") {
                    const identifier = (entry as { id?: string }).id;
                    if (typeof identifier === "string" && identifier.trim().length > 0) {
                        ids.add(identifier.trim());
                    }
                }
            }
        };

        addEntries(inspectResult.defaultValue);
        addEntries(inspectResult.globalValue);
        addEntries(inspectResult.workspaceValue);
        addEntries(inspectResult.workspaceFolderValue);

        const inspectWithLanguages = inspectResult as Record<string, T[] | undefined>;
        addEntries(inspectWithLanguages.globalLanguageValue as T[] | undefined);
        addEntries(inspectWithLanguages.workspaceLanguageValue as T[] | undefined);
        addEntries(inspectWithLanguages.workspaceFolderLanguageValue as T[] | undefined);
        addEntries(inspectWithLanguages.languageValue as T[] | undefined);

        return ids;
    }
}
