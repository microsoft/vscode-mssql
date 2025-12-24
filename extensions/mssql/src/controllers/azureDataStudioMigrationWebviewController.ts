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
    AzureDataStudioMigrationBrowseForConfigRequest,
    AzureDataStudioMigrationReducers,
    AzureDataStudioMigrationWebviewState,
    MigrationStatus,
} from "../sharedInterfaces/azureDataStudioMigration";
import { AuthenticationType, IConnectionDialogProfile } from "../sharedInterfaces/connectionDialog";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import VscodeWrapper from "./vscodeWrapper";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { IConnectionGroup } from "../sharedInterfaces/connectionGroup";
import { getErrorMessage } from "../utils/utils";
import { ConnectionConfig } from "../connectionconfig/connectionconfig";
import { Deferred } from "../protocol";
import { AzureAccountService } from "../services/azureAccountService";
import { IAccount } from "vscode-mssql";

const defaultState: AzureDataStudioMigrationWebviewState = {
    adsConfigPath: "",
    connectionGroups: [],
    connections: [],
    rootGroupIds: [],
    dialog: undefined,
};

export class AzureDataStudioMigrationWebviewController extends ReactWebviewPanelController<
    AzureDataStudioMigrationWebviewState,
    AzureDataStudioMigrationReducers
> {
    public readonly initialized: Deferred<void> = new Deferred<void>();

    private _existingConnectionIds: Set<string> = new Set<string>();
    private _existingGroupIds: Set<string> = new Set<string>();

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private connectionConfig: ConnectionConfig,
        private azureAccountService: AzureAccountService,
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
        this.registerReducerHandlers();
        void this.initialize()
            .then(() => {
                this.updateState();
                this.initialized.resolve();
            })
            .catch((err) => {
                void vscode.window.showErrorMessage(getErrorMessage(err));

                sendErrorEvent(
                    TelemetryViews.AzureDataStudioMigration,
                    TelemetryActions.Initialize,
                    err,
                    true, // includeErrorMessage
                    undefined, // errorCode,
                    "catchAll", // errorType
                );
                this.initialized.reject(getErrorMessage(err));
            });
    }

    private async initialize() {
        await this.loadAdsConfigFromDefaultPath();
        await this.loadEntraAuthAccounts();
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

    private registerReducerHandlers() {
        this.registerReducer("openEntraSignInDialog", async (state, payload) => {
            const connection = state.connections.find(
                (conn) => conn.profile.id === payload.connectionId,
            );

            if (!connection) {
                state.dialog = undefined;
                return state;
            }

            state.dialog = {
                type: "entraSignIn",
                connectionId: payload.connectionId,
                title: AzureDataStudioMigration.EntraSignInDialogTitle,
                message: AzureDataStudioMigration.EntraSignInDialogMessage,
                accountDisplayName: this.getAccountDisplayName(connection),
                tenantIdDisplayName: this.getTenantDisplayName(connection),
                primaryButtonText: AzureDataStudioMigration.EntraSignInDialogPrimaryButton,
                secondaryButtonText: AzureDataStudioMigration.EntraSignInDialogSecondaryButton,
            };

            return state;
        });

        this.registerReducer("closeDialog", async (state) => {
            state.dialog = undefined;
            return state;
        });

        this.registerReducer("signIntoEntraAccount", async (state) => {
            if (!state.dialog || state.dialog.type !== "entraSignIn") {
                return state;
            }

            const targetAccount = state.dialog.accountDisplayName
            
            const account = await this.azureAccountService.addAccount();

            if ()

            // Placeholder reducer - the actual sign-in workflow will be implemented later.
            state.dialog = undefined;
            return state;
        });
    }

    private async loadEntraAuthAccounts(): Promise<void> {
        // TODO
    }

    private async loadAdsConfigFromDefaultPath(): Promise<void> {
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
            await this.loadExistingConfigItems();

            const raw = await fs.readFile(filePath, { encoding: "utf8" });
            const parsed = JSON.parse(stripJsonComments(raw)) as Record<string, unknown>;

            const { groups, rootGroupIds } = this.parseConnectionGroups(
                parsed?.["datasource.connectionGroups"],
            );
            const migrationGroups = await this.updateGroupStatuses(groups);

            const connections = this.parseConnections(parsed?.["datasource.connections"]);

            const migrationConnections = await this.updateConnectionStatuses(connections);

            this.state = {
                adsConfigPath: filePath,
                connectionGroups: migrationGroups,
                connections: migrationConnections,
                rootGroupIds: rootGroupIds, // TODO: why is this needed?
                dialog: undefined,
            };
        } catch (error) {
            void vscode.window.showErrorMessage(
                `Failed to load Azure Data Studio settings: ${getErrorMessage(error)}`,
            );
        }
    }

    private async readValidAzureAccounts(): Promise<IAccount[]> {
        let azureAccounts: IAccount[] = [];
        try {
            azureAccounts = await this.azureAccountService.getAccounts();

            // check that all accounts are valid
            for (const account of azureAccounts) {
                if (!account?.displayInfo?.displayName || !account?.key?.id) {
                    throw new Error(`Invalid Azure account found: ${JSON.stringify(account)}`);
                }
            }
        } catch (error) {
            this.logger.error(`Error loading Azure accounts: ${getErrorMessage(error)}`);

            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.LoadAzureAccountsForEntraAuth,
                error,
                false, // includeErrorMessage
                undefined, // errorCode
                undefined, // errorType
                undefined, // additionalProperties
                {
                    accountCount: azureAccounts.length,
                    undefinedAccountCount: azureAccounts.filter((x) => x === undefined).length,
                    undefinedDisplayInfoCount: azureAccounts.filter(
                        (x) => x !== undefined && x.displayInfo === undefined,
                    ).length,
                }, // additionalMeasurements
            );
        }

        return azureAccounts;
    }

    private async updateConnectionStatuses(
        connections: IConnectionDialogProfile[],
    ): Promise<AdsMigrationConnection[]> {
        const result: AdsMigrationConnection[] = [];

        const azureAccounts = new Set<string>(
            (await this.readValidAzureAccounts()).map((account) => account.key.id),
        );

        for (const connection of connections) {
            let status = MigrationStatus.Ready;
            let statusMessage = "";

            if (this._existingConnectionIds.has(connection.id)) {
                status = MigrationStatus.AlreadyImported;
                statusMessage = AzureDataStudioMigration.ConnectionStatusAlreadyImported;
            } else if (connection.authenticationType === AuthenticationType.SqlLogin) {
                if (!connection.password) {
                    status = MigrationStatus.NeedsAttention;
                    statusMessage = AzureDataStudioMigration.connectionIssueMissingSqlPassword(
                        connection.user,
                    );
                }
            } else if (connection.authenticationType === AuthenticationType.AzureMFA) {
                if (!azureAccounts.has(connection.accountId)) {
                    status = MigrationStatus.NeedsAttention;
                    statusMessage = AzureDataStudioMigration.connectionIssueMissingAzureAccount(
                        connection.user,
                    );
                }
            }

            result.push({
                profile: connection,
                profileName: connection.profileName,
                status,
                statusMessage,
                selected: status === MigrationStatus.Ready,
            });
        }

        return result;
    }

    private updateGroupStatuses(groups: IConnectionGroup[]): AdsMigrationConnectionGroup[] {
        const result: AdsMigrationConnectionGroup[] = [];

        for (const group of groups) {
            let status = MigrationStatus.Ready;
            let statusMessage = "";

            if (this._existingGroupIds.has(group.id)) {
                status = MigrationStatus.AlreadyImported;
                statusMessage = AzureDataStudioMigration.ConnectionGroupStatusAlreadyImported;
            }

            result.push({
                group: group,
                status,
                statusMessage,
                selected: status === MigrationStatus.Ready,
            });
        }

        return result;
    }

    private parseConnectionGroups(value: unknown): {
        groups: IConnectionGroup[];
        rootGroupIds: string[];
    } {
        if (!Array.isArray(value)) {
            return {
                groups: [],
                rootGroupIds: [],
            };
        }

        const groups: IConnectionGroup[] = [];
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

    private createGroup(candidate: unknown): IConnectionGroup | undefined {
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

        return group;
    }

    private parseConnections(value: unknown): IConnectionDialogProfile[] {
        if (!Array.isArray(value)) {
            return [];
        }

        const connections: IConnectionDialogProfile[] = [];
        for (const entry of value) {
            const connection = this.createConnection(entry);
            if (connection) {
                connections.push(connection);
            }
        }

        return connections;
    }

    private createConnection(candidate: unknown): IConnectionDialogProfile | undefined {
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
        const profileName = this.getString(options, ["connectionName", "name", "profileName"]);

        const azureAuthAccountId = this.getString(options, ["azureAccount"]);
        const azureAuthTenantId = this.getString(options, ["azureTenantId"]);

        // TODO: clean up all this stuff.  Fallbacks aren't necessary.
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
            accountId: azureAuthAccountId,
            tenantId: azureAuthTenantId,
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

        return profile;
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

    private async loadExistingConfigItems(): Promise<void> {
        const connections = await this.connectionConfig.getConnections();
        this._existingConnectionIds = new Set(connections.map((conn) => conn.id));

        const connectionGroups = await this.connectionConfig.getGroups();
        this._existingGroupIds = new Set(connectionGroups.map((group) => group.id));
    }

    private getAccountDisplayName(connection: AdsMigrationConnection): string {
        return (
            connection.profile.user?.trim() ??
            connection.profile.accountId?.trim() ??
            AzureDataStudioMigration.EntraSignInDialogUnknownAccount
        );
    }

    private getTenantDisplayName(connection: AdsMigrationConnection): string {
        return (
            connection.profile.tenantId?.trim() ??
            AzureDataStudioMigration.EntraSignInDialogUnknownTenant
        );
    }
}
