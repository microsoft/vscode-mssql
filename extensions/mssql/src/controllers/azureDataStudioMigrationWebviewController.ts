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
    EntraAccountOption,
    AzureDataStudioMigrationReducers,
    AzureDataStudioMigrationWebviewState,
    EntraSignInDialogProps,
    ImportProgressDialogProps,
    MigrationStatus,
    ImportWarningDialogProps,
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
import { getConnectionDisplayName } from "../models/connectionInfo";
import * as interfaces from "../models/interfaces";
import { ConnectionStore } from "../models/connectionStore";
import { ApiStatus } from "../sharedInterfaces/webview";

const defaultState: AzureDataStudioMigrationWebviewState = {
    adsConfigPath: "",
    connectionGroups: [],
    connections: [],
    dialog: undefined,
};

const AZURE_DATA_STUDIO_MIGRATION_VIEW_ID = "azureDataStudioMigration";

export class AzureDataStudioMigrationWebviewController extends ReactWebviewPanelController<
    AzureDataStudioMigrationWebviewState,
    AzureDataStudioMigrationReducers
> {
    public readonly initialized: Deferred<void> = new Deferred<void>();

    private _existingConnectionIds: Map<string, string> = new Map<string, string>();
    private _existingGroupIds: Map<string, string> = new Map<string, string>();
    private _entraAuthAccounts: IAccount[] = [];

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private connectionStore: ConnectionStore,
        private connectionConfig: ConnectionConfig,
        private azureAccountService: AzureAccountService,
        initialState: AzureDataStudioMigrationWebviewState = defaultState,
    ) {
        super(
            context,
            vscodeWrapper,
            AZURE_DATA_STUDIO_MIGRATION_VIEW_ID,
            AZURE_DATA_STUDIO_MIGRATION_VIEW_ID,
            initialState,
            {
                title: AzureDataStudioMigration.PageTitle,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", "connect_dark.svg"),
                    light: vscode.Uri.joinPath(context.extensionUri, "media", "connect_light.svg"),
                },
            },
        );

        this.registerHandlers();

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
        await this.loadEntraAuthAccounts();
        await this.loadAdsConfigFromDefaultPath();
    }

    private registerHandlers() {
        this.onRequest(AzureDataStudioMigrationBrowseForConfigRequest.type, async () => {
            const selection = await vscode.window.showOpenDialog({
                title: AzureDataStudioMigration.SelectConfigFileDialogTitle,
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

        this.registerReducer("openEntraSignInDialog", async (state, payload) => {
            const connection = state.connections.find(
                (conn) => conn.profile.id === payload.connectionId,
            );

            if (!connection) {
                console.error("Cannot open Entra sign-in dialog for undefined connection");
                state.dialog = undefined;
                return state;
            }

            if (connection.profile.authenticationType !== AuthenticationType.AzureMFA) {
                console.error(
                    `Cannot open Entra sign-in dialog for connection with authentication type: ${connection?.profile.authenticationType}`,
                );
                state.dialog = undefined;
                return state;
            }

            if (!this._entraAuthAccounts?.length) {
                await this.loadEntraAuthAccounts();
            }

            const accountOptions = this.mapAccountsToOptions(this._entraAuthAccounts);

            state.dialog = {
                type: "entraSignIn",
                connectionId: payload.connectionId,
                originalEntraAccount: connection.profile.user || "",
                originalEntraTenantId: connection.profile.tenantId || "",
                entraAuthAccounts: accountOptions,
            } as EntraSignInDialogProps;

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

            const dialog = state.dialog as EntraSignInDialogProps;

            await this.azureAccountService.addAccount();
            await this.loadEntraAuthAccounts();

            const connection = state.connections.find(
                (conn) => conn.profile.id === dialog.connectionId,
            );
            if (!connection) {
                return state;
            }

            const accountOptions = this.mapAccountsToOptions(this._entraAuthAccounts);
            const { selectedAccountId, selectedTenantId } = this.resolveAccountSelection(
                connection,
                accountOptions,
            );

            dialog.entraAuthAccounts = accountOptions;
            dialog.originalEntraAccount = this.getAccountDisplayNameFromOptions(
                accountOptions,
                selectedAccountId,
            );
            dialog.originalEntraTenantId = this.getTenantDisplayNameFromOptions(
                accountOptions,
                selectedAccountId,
                selectedTenantId,
            );

            for (const connection of state.connections) {
                this.updateConnectionStatus(connection);
            }

            return state;
        });

        this.registerReducer("selectAccount", async (state, payload) => {
            const connection = state.connections.find(
                (conn) => conn.profile.id === payload.connectionId,
            );

            const entraAccount = this._entraAuthAccounts.find(
                (acct) => acct.key.id === payload.accountId,
            );

            if (connection && entraAccount) {
                connection.profile.user =
                    entraAccount.displayInfo.displayName || entraAccount.displayInfo.email || "";
                connection.profile.accountId = payload.accountId;
                connection.profile.tenantId = payload.tenantId;
                connection.profile.email = entraAccount.displayInfo.email || "";

                this.updateConnectionStatus(connection);
            }

            state.dialog = undefined;
            return state;
        });

        this.registerReducer("enterSqlPassword", async (state, payload) => {
            const connection = state.connections.find(
                (conn) => conn.profile.id === payload.connectionId,
            );

            if (!connection) {
                return state;
            }

            if (connection.profile.authenticationType !== AuthenticationType.SqlLogin) {
                this.logger.error(
                    `Cannot enter SQL password for connection with authentication type: ${connection?.profile.authenticationType}`,
                );
                return state;
            }

            connection.profile.password = payload.password ?? "";

            this.updateConnectionStatus(connection);

            return state;
        });

        this.registerReducer("setConnectionGroupSelections", async (state, payload) => {
            if (payload.groupId) {
                // set selection for specific group
                const group = state.connectionGroups.find(
                    (grp) => grp.group.id === payload.groupId,
                );

                if (group) {
                    group.selected = payload.selected;
                }
            } else {
                // set selection for all groups
                state.connectionGroups.forEach((group) => {
                    group.selected = payload.selected;
                });
            }

            return state;
        });

        this.registerReducer("setConnectionSelections", async (state, payload) => {
            if (payload.connectionId) {
                // set selection for specific connection
                const connection = state.connections.find(
                    (conn) => conn.profile.id === payload.connectionId,
                );

                if (connection) {
                    connection.selected = payload.selected;
                }
            } else {
                // set selection for all connections
                state.connections.forEach((connection) => {
                    connection.selected = payload.selected;
                });
            }
            return state;
        });

        this.registerReducer("import", async (state) => {
            const warnings = [];

            for (const connection of state.connections) {
                if (connection.selected && connection.status === MigrationStatus.NeedsAttention) {
                    warnings.push(
                        `${getConnectionDisplayName(connection.profile)}: ${connection.statusMessage}`,
                    );
                }
            }

            if (warnings.length > 0) {
                state.dialog = {
                    type: "importWarning",
                    warnings: warnings,
                } as ImportWarningDialogProps;
                return state;
            }

            await this.importHelper(state);
            return state;
        });

        this.registerReducer("confirmImport", async (state) => {
            await this.importHelper(state);
            return state;
        });
    }

    private async loadEntraAuthAccounts(): Promise<void> {
        this._entraAuthAccounts = await this.readValidAzureAccounts();
    }

    private async importHelper(state: AzureDataStudioMigrationWebviewState): Promise<void> {
        const selectedGroups = new Map<string, AdsMigrationConnectionGroup>(
            state.connectionGroups
                .filter((group) => group.selected)
                .map((group) => [group.group.id, group]),
        );
        const selectedConnections = state.connections.filter((connection) => connection.selected);

        state.dialog = {
            type: "importProgress",
            status: {
                status: ApiStatus.Loading,
            },
        } as ImportProgressDialogProps;

        this.updateState(state);

        sendActionEvent(
            TelemetryViews.AzureDataStudioMigration,
            TelemetryActions.ImportConfig,
            {},
            {
                connectionCount: selectedConnections.length,
                groupCount: selectedGroups.size,
            },
        );

        try {
            const validGroupIds = new Set<string>([
                ...this._existingGroupIds.keys(),
                ...selectedGroups.keys(),
            ]);

            for (const group of selectedGroups.values()) {
                const groupToAdd: interfaces.IConnectionGroup = {
                    ...group.group,
                    configSource: vscode.ConfigurationTarget.Global,
                };

                if (!validGroupIds.has(groupToAdd.parentId)) {
                    groupToAdd.parentId = ConnectionConfig.ROOT_GROUP_ID;
                }

                await this.connectionConfig.addGroup(groupToAdd);
            }

            for (const connection of selectedConnections) {
                const connectionToAdd: interfaces.IConnectionProfile = {
                    ...connection.profile,
                    configSource: vscode.ConfigurationTarget.Global,
                } as interfaces.IConnectionProfile;

                // use root group for connections with invalid group IDs
                if (!validGroupIds.has(connectionToAdd.groupId)) {
                    connectionToAdd.groupId = ConnectionConfig.ROOT_GROUP_ID;
                }

                // add email for AzureMFA connections
                if (connectionToAdd.authenticationType === AuthenticationType.AzureMFA) {
                    const entraAccount = this._entraAuthAccounts.find(
                        (acct) => acct.key.id === connectionToAdd.accountId,
                    );

                    if (entraAccount) {
                        connectionToAdd.email = entraAccount.displayInfo.email || "";
                    }
                }

                await this.connectionStore.saveProfile(connectionToAdd);
            }

            state.dialog = {
                type: "importProgress",
                status: {
                    status: ApiStatus.Loaded,
                    message: AzureDataStudioMigration.importProgressSuccessMessage,
                },
            } as ImportProgressDialogProps;
        } catch (err) {
            this.state.dialog = {
                status: {
                    status: ApiStatus.Error,
                    message: AzureDataStudioMigration.importProgressErrorMessage(
                        getErrorMessage(err),
                    ),
                },
            } as ImportProgressDialogProps;

            sendErrorEvent(
                TelemetryViews.AzureDataStudioMigration,
                TelemetryActions.ImportConfig,
                err,
                true,
                undefined,
                undefined,
                undefined,
                {
                    connectionCount: selectedConnections.length,
                    groupCount: selectedGroups.size,
                },
            );
        }
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

            const groups = this.parseConnectionGroups(parsed?.["datasource.connectionGroups"]);
            const migrationGroups = this.updateGroupStatuses(groups);

            const connections = this.parseConnections(parsed?.["datasource.connections"]);
            const migrationConnections = this.updateConnectionStatuses(connections);

            this.state = {
                adsConfigPath: filePath,
                connectionGroups: migrationGroups,
                connections: migrationConnections,
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

    private updateConnectionStatuses(
        connections: IConnectionDialogProfile[],
    ): AdsMigrationConnection[] {
        const result: AdsMigrationConnection[] = [];

        for (const connection of connections) {
            result.push(
                this.updateConnectionStatus({
                    profile: connection,
                    profileName: connection.profileName,
                    status: MigrationStatus.Ready, // default props that get updated in this call
                    statusMessage: "",
                    selected: true,
                }),
            );
        }

        return result;
    }

    private updateConnectionStatus(connection: AdsMigrationConnection): AdsMigrationConnection {
        if (this._existingConnectionIds.has(connection.profile.id)) {
            connection.status = MigrationStatus.AlreadyImported;
            connection.statusMessage = AzureDataStudioMigration.ConnectionStatusAlreadyImported(
                this._existingConnectionIds.get(connection.profile.id)!,
                connection.profile.id,
            );
        } else {
            connection.status = MigrationStatus.Ready;
            connection.statusMessage = AzureDataStudioMigration.ImportStatusReady;

            if (connection.profile.authenticationType === AuthenticationType.SqlLogin) {
                if (!connection.profile.password?.length) {
                    connection.status = MigrationStatus.NeedsAttention;
                    connection.statusMessage =
                        AzureDataStudioMigration.connectionIssueMissingSqlPassword(
                            connection.profile.user,
                        );
                }
            } else if (connection.profile.authenticationType === AuthenticationType.AzureMFA) {
                if (
                    !this._entraAuthAccounts.find(
                        (account) => account.key.id === connection.profile.accountId,
                    )
                ) {
                    connection.status = MigrationStatus.NeedsAttention;
                    connection.statusMessage =
                        AzureDataStudioMigration.connectionIssueMissingAzureAccount(
                            connection.profile.user,
                        );
                }
            }
        }

        connection.selected = connection.status === MigrationStatus.Ready;

        return connection;
    }

    private updateGroupStatuses(groups: IConnectionGroup[]): AdsMigrationConnectionGroup[] {
        const result: AdsMigrationConnectionGroup[] = [];

        for (const group of groups) {
            result.push(
                this.updateConnectionGroupStatus({
                    group: group,
                    status: MigrationStatus.Ready, // default props that get updated in this call
                    statusMessage: "",
                    selected: true,
                }),
            );
        }

        return result;
    }

    private updateConnectionGroupStatus(
        connectionGroup: AdsMigrationConnectionGroup,
    ): AdsMigrationConnectionGroup {
        if (this._existingGroupIds.has(connectionGroup.group.id)) {
            connectionGroup.status = MigrationStatus.AlreadyImported;
            connectionGroup.statusMessage =
                AzureDataStudioMigration.ConnectionGroupStatusAlreadyImported(
                    this._existingGroupIds.get(connectionGroup.group.id),
                    connectionGroup.group.id,
                );
        } else {
            connectionGroup.status = MigrationStatus.Ready;
            connectionGroup.statusMessage = AzureDataStudioMigration.ImportStatusReady;
        }

        connectionGroup.selected = connectionGroup.status === MigrationStatus.Ready;

        return connectionGroup;
    }

    private parseConnectionGroups(value: unknown): IConnectionGroup[] {
        if (!Array.isArray(value)) {
            return [];
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

        return groups;
    }

    private createGroup(candidate: unknown): IConnectionGroup | undefined {
        if (!candidate || typeof candidate !== "object") {
            return undefined;
        }

        const record = candidate as Record<string, unknown>;
        const id = this.getStringValue(record, "id") ?? this.getStringValue(record, "groupId");
        const name =
            this.getStringValue(record, "name") ?? this.getStringValue(record, "groupName");
        if (!id || !name) {
            return undefined;
        }

        const group: IConnectionGroup = {
            id,
            name,
            parentId: this.getStringValue(record, "parentId"),
            color: this.getStringValue(record, "color"),
            description: this.getStringValue(record, "description"),
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
        const options =
            typeof record.options === "object" && record.options
                ? (record.options as Record<string, unknown>)
                : record;

        const providerNameValue = this.getStringValue(record, "providerName");
        if (providerNameValue && providerNameValue.toLowerCase() !== "mssql") {
            return undefined;
        }

        const profile: IConnectionDialogProfile = {
            ...(options as Record<string, unknown>),
        } as unknown as IConnectionDialogProfile;

        // overrides from the top-level ADS record
        profile.id = this.getStringValue(record, "id");
        profile.groupId = this.getStringValue(record, "groupId");
        profile.savePassword = this.getBooleanValue(record, "savePassword");

        // overrides from the ADS options
        profile.profileName = this.getStringValue(options, "connectionName");
        profile.port = this.getNumberValue(options, "port", undefined /* defaultValue */);
        profile.emptyPasswordInput = this.getBooleanValue(options, "emptyPasswordInput");
        profile.trustServerCertificate = this.getBooleanValue(
            options,
            "trustServerCertificate",
            true, // defaultValue
        );

        // additional overrides for Entra authentication
        profile.accountId = this.getStringValue(options, "azureAccount");
        profile.tenantId = this.getStringValue(options, "azureTenantId");

        // additional cleanup for property names that differ between MSSQL and ADS
        /* eslint-disable @typescript-eslint/no-explicit-any */
        delete (profile as any).connectionName;
        delete (profile as any).azureTenantId;
        delete (profile as any).azureAccount;
        delete (profile as any).databaseDisplayName;
        /* eslint-enable @typescript-eslint/no-explicit-any */

        return profile;
    }

    private getStringValue(
        source: Record<string, unknown> | undefined,
        property: string,
        defaultValue: string = "",
    ): string | undefined {
        if (!source) {
            return defaultValue;
        }
        const value = source[property];
        if (typeof value === "string") {
            return value;
        }

        return defaultValue;
    }

    private getNumberValue(
        source: Record<string, unknown> | undefined,
        property: string,
        defaultValue: number,
    ): number | undefined {
        if (!source) {
            return defaultValue;
        }
        const value = source[property];
        if (typeof value === "number") {
            return value;
        }

        return defaultValue;
    }

    private getBooleanValue(
        source: Record<string, unknown> | undefined,
        property: string,
        defaultValue: boolean = false,
    ): boolean {
        if (!source) {
            return defaultValue;
        }
        const value = source[property];
        if (typeof value === "boolean") {
            return value;
        } else if (typeof value === "string") {
            return value.toLowerCase() === "true";
        }

        return defaultValue;
    }

    private async loadExistingConfigItems(): Promise<void> {
        const connections = await this.connectionConfig.getConnections();
        this._existingConnectionIds = new Map(
            connections.map((conn) => [conn.id, getConnectionDisplayName(conn)]),
        );

        const connectionGroups = await this.connectionConfig.getGroups();
        this._existingGroupIds = new Map(connectionGroups.map((group) => [group.id, group.name]));
    }

    private mapAccountsToOptions(accounts: IAccount[]): EntraAccountOption[] {
        return accounts.map((account) => ({
            id: account.key.id,
            displayName:
                account.displayInfo?.displayName ?? account.displayInfo?.userId ?? account.key.id,
            tenants:
                account.properties?.tenants?.map((tenant) => ({
                    id: tenant.id,
                    displayName: tenant.displayName ?? tenant.id,
                })) ?? [],
        }));
    }

    private resolveAccountSelection(
        connection: AdsMigrationConnection,
        accounts: EntraAccountOption[],
    ): { selectedAccountId?: string; selectedTenantId?: string } {
        let selectedAccountId = connection.profile.accountId;
        if (!selectedAccountId || !accounts.some((acct) => acct.id === selectedAccountId)) {
            selectedAccountId = accounts[0]?.id;
        }

        let selectedTenantId = connection.profile.tenantId;
        const account = accounts.find((acct) => acct.id === selectedAccountId);
        if (
            !selectedTenantId ||
            !account?.tenants.some((tenant) => tenant.id === selectedTenantId)
        ) {
            selectedTenantId = account?.tenants[0]?.id;
        }

        return { selectedAccountId, selectedTenantId };
    }

    private getAccountDisplayNameFromOptions(
        accounts: EntraAccountOption[],
        accountId?: string,
    ): string {
        if (!accountId) {
            return AzureDataStudioMigration.EntraSignInDialogUnknownAccount;
        }

        return (
            accounts.find((acct) => acct.id === accountId)?.displayName ??
            AzureDataStudioMigration.EntraSignInDialogUnknownAccount
        );
    }

    private getTenantDisplayNameFromOptions(
        accounts: EntraAccountOption[],
        accountId?: string,
        tenantId?: string,
    ): string {
        if (!accountId || !tenantId) {
            return AzureDataStudioMigration.EntraSignInDialogUnknownTenant;
        }

        const account = accounts.find((acct) => acct.id === accountId);
        return (
            account?.tenants.find((tenant) => tenant.id === tenantId)?.displayName ??
            AzureDataStudioMigration.EntraSignInDialogUnknownTenant
        );
    }
}
