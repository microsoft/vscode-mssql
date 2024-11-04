/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import {
    ActivityStatus,
    ActivityObject,
    TelemetryActions,
    TelemetryViews,
} from "../sharedInterfaces/telemetry";
import {
    AuthenticationType,
    AzureSubscriptionInfo,
    ConnectionDialogFormItemSpec,
    ConnectionDialogReducers,
    ConnectionDialogWebviewState,
    ConnectionInputMode,
    IConnectionDialogProfile,
} from "../sharedInterfaces/connectionDialog";
import {
    CapabilitiesResult,
    GetCapabilitiesRequest,
} from "../models/contracts/connection";
import {
    FormItemActionButton,
    FormItemOptions,
    FormItemSpec,
    FormItemType,
} from "../reactviews/common/forms/form";
import {
    ConnectionDialog as Loc,
    refreshTokenLabel,
} from "../constants/locConstants";
import {
    azureSubscriptionFilterConfigKey,
    confirmVscodeAzureSignin,
    fetchServersFromAzure,
    promptForAzureSubscriptionFilter,
} from "./azureHelper";
import {
    sendActionEvent,
    sendErrorEvent,
    startActivity,
} from "../telemetry/telemetry";

import { ApiStatus } from "../sharedInterfaces/webview";
import { AzureController } from "../azure/azureController";
import { AzureSubscription } from "@microsoft/vscode-azext-azureauth";
import { ConnectionOption } from "azdata";
import { IConnectionInfo } from "vscode-mssql";
import { Logger } from "../models/logger";
import MainController from "../controllers/mainController";
import { ObjectExplorerProvider } from "../objectExplorer/objectExplorerProvider";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import { UserSurvey } from "../nps/userSurvey";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { connectionCertValidationFailedErrorCode } from "./connectionConstants";
import { getConnectionDisplayName } from "../models/connectionInfo";
import { getErrorMessage } from "../utils/utils";
import { l10n } from "vscode";

export class ConnectionDialogWebviewController extends ReactWebviewPanelController<
    ConnectionDialogWebviewState,
    ConnectionDialogReducers
> {
    private _connectionToEditCopy: IConnectionDialogProfile | undefined;

    private static _logger: Logger;
    private _azureSubscriptions: Map<string, AzureSubscription>;

    constructor(
        context: vscode.ExtensionContext,
        private _mainController: MainController,
        private _objectExplorerProvider: ObjectExplorerProvider,
        private _connectionToEdit?: IConnectionInfo,
    ) {
        super(
            context,
            "connectionDialog",
            new ConnectionDialogWebviewState({
                connectionProfile: {} as IConnectionDialogProfile,
                recentConnections: [],
                selectedInputMode: ConnectionInputMode.Parameters,
                connectionComponents: {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    components: {} as any, // force empty record for intial blank state
                    mainOptions: [],
                    topAdvancedOptions: [],
                    groupedAdvancedOptions: {},
                },
                azureSubscriptions: [],
                azureServers: [],
                connectionStatus: ApiStatus.NotStarted,
                formError: "",
                loadingAzureSubscriptionsStatus: ApiStatus.NotStarted,
                loadingAzureServersStatus: ApiStatus.NotStarted,
                trustServerCertError: undefined,
            }),
            {
                title: Loc.connectionDialog,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "connectionDialogEditor_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "connectionDialogEditor_light.svg",
                    ),
                },
            },
        );

        if (!ConnectionDialogWebviewController._logger) {
            const vscodeWrapper = new VscodeWrapper();
            const channel = vscodeWrapper.createOutputChannel(
                Loc.connectionDialog,
            );
            ConnectionDialogWebviewController._logger = Logger.create(channel);
        }

        this.registerRpcHandlers();
        this.initializeDialog().catch((err) => {
            void vscode.window.showErrorMessage(getErrorMessage(err));

            // The spots in initializeDialog() that handle potential PII have their own error catches that emit error telemetry with `includeErrorMessage` set to false.
            // Everything else during initialization shouldn't have PII, so it's okay to include the error message here.
            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.Initialize,
                err,
                true, // includeErrorMessage
            );
        });
    }

    private async initializeDialog() {
        try {
            this.state.recentConnections = await this.loadRecentConnections();
            this.updateState();
        } catch (err) {
            void vscode.window.showErrorMessage(getErrorMessage(err));
            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.Initialize,
                err,
                false, // includeErrorMessage
            );
        }

        try {
            if (this._connectionToEdit) {
                await this.loadConnectionToEdit();
            } else {
                await this.loadEmptyConnection();
            }
        } catch (err) {
            await this.loadEmptyConnection();
            void vscode.window.showErrorMessage(getErrorMessage(err));

            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.Initialize,
                err,
                false, // includeErrorMessage
            );
        }

        this.state.connectionComponents = {
            components: await this.generateConnectionComponents(),
            mainOptions: [
                "server",
                "trustServerCertificate",
                "authenticationType",
                "user",
                "password",
                "savePassword",
                "accountId",
                "tenantId",
                "database",
                "encrypt",
            ],
            topAdvancedOptions: [
                "port",
                "applicationName",
                // TODO: 'autoDisconnect',
                // TODO: 'sslConfiguration',
                "connectTimeout",
                "multiSubnetFailover",
            ],
            groupedAdvancedOptions: {}, // computed below
        };

        this.state.connectionComponents.groupedAdvancedOptions =
            this.groupAdvancedOptions(this.state.connectionComponents);

        await this.updateItemVisibility();
        this.updateState();
    }

    private async loadRecentConnections(): Promise<IConnectionDialogProfile[]> {
        const recentConnections =
            this._mainController.connectionManager.connectionStore
                .loadAllConnections(true)
                .map((c) => c.connectionCreds);

        sendActionEvent(
            TelemetryViews.ConnectionDialog,
            TelemetryActions.LoadRecentConnections,
            undefined, // additionalProperties
            {
                recentConnectionsCount: recentConnections.length,
            },
        );

        const dialogConnections: IConnectionDialogProfile[] = [];
        for (let i = 0; i < recentConnections.length; i++) {
            dialogConnections.push(
                await this.initializeConnectionForDialog(recentConnections[i]),
            );
        }

        return dialogConnections;
    }

    private async loadConnectionToEdit() {
        if (this._connectionToEdit) {
            this._connectionToEditCopy = structuredClone(
                this._connectionToEdit,
            );
            const connection = await this.initializeConnectionForDialog(
                this._connectionToEdit,
            );
            this.state.connectionProfile = connection;

            this.state.selectedInputMode =
                connection.connectionString && connection.server === undefined
                    ? ConnectionInputMode.ConnectionString
                    : ConnectionInputMode.Parameters;
            this.updateState();
        }
    }

    private async loadEmptyConnection() {
        const emptyConnection = {
            authenticationType: AuthenticationType.SqlLogin,
            connectTimeout: 15, // seconds
            applicationName: "vscode-mssql",
        } as IConnectionDialogProfile;
        this.state.connectionProfile = emptyConnection;
    }

    private async initializeConnectionForDialog(
        connection: IConnectionInfo,
    ): Promise<IConnectionDialogProfile> {
        // Load the password if it's saved
        const isConnectionStringConnection =
            connection.connectionString !== undefined &&
            connection.connectionString !== "";
        if (!isConnectionStringConnection) {
            const password =
                await this._mainController.connectionManager.connectionStore.lookupPassword(
                    connection,
                    isConnectionStringConnection,
                );
            connection.password = password;
        } else {
            // If the connection is a connection string connection with SQL Auth:
            //   * the full connection string is stored as the "password" in the credential store
            //   * we need to extract the password from the connection string
            // If the connection is a connection string connection with a different auth type, then there's nothing in the credential store.

            const connectionString =
                await this._mainController.connectionManager.connectionStore.lookupPassword(
                    connection,
                    isConnectionStringConnection,
                );

            if (connectionString) {
                const passwordIndex = connectionString
                    .toLowerCase()
                    .indexOf("password=");

                if (passwordIndex !== -1) {
                    // extract password from connection string; found between 'Password=' and the next ';'
                    const passwordStart = passwordIndex + "password=".length;
                    const passwordEnd = connectionString.indexOf(
                        ";",
                        passwordStart,
                    );
                    if (passwordEnd !== -1) {
                        connection.password = connectionString.substring(
                            passwordStart,
                            passwordEnd,
                        );
                    }

                    // clear the connection string from the IConnectionDialogProfile so that the ugly connection string key
                    // that's used to look up the actual connection string (with password) isn't displayed
                    connection.connectionString = "";
                }
            }
        }

        const dialogConnection = connection as IConnectionDialogProfile;
        // Set the display name
        dialogConnection.displayName = dialogConnection.profileName
            ? dialogConnection.profileName
            : getConnectionDisplayName(connection);
        return dialogConnection;
    }

    private async updateItemVisibility() {
        let hiddenProperties: (keyof IConnectionDialogProfile)[] = [];

        if (
            this.state.selectedInputMode === ConnectionInputMode.Parameters ||
            this.state.selectedInputMode === ConnectionInputMode.AzureBrowse
        ) {
            if (
                this.state.connectionProfile.authenticationType !==
                AuthenticationType.SqlLogin
            ) {
                hiddenProperties.push("user", "password", "savePassword");
            }
            if (
                this.state.connectionProfile.authenticationType !==
                AuthenticationType.AzureMFA
            ) {
                hiddenProperties.push("accountId", "tenantId");
            }
            if (
                this.state.connectionProfile.authenticationType ===
                AuthenticationType.AzureMFA
            ) {
                // Hide tenantId if accountId has only one tenant
                const tenants = await this.getTenants(
                    this.state.connectionProfile.accountId,
                );
                if (tenants.length === 1) {
                    hiddenProperties.push("tenantId");
                }
            }
        }

        for (const component of Object.values(
            this.state.connectionComponents.components,
        )) {
            component.hidden = hiddenProperties.includes(
                component.propertyName,
            );
        }
    }

    private getActiveFormComponents(): (keyof IConnectionDialogProfile)[] {
        if (
            this.state.selectedInputMode === ConnectionInputMode.Parameters ||
            this.state.selectedInputMode === ConnectionInputMode.AzureBrowse
        ) {
            return this.state.connectionComponents.mainOptions;
        }
        return ["connectionString", "profileName"];
    }

    private getFormComponent(
        propertyName: keyof IConnectionDialogProfile,
    ): FormItemSpec<IConnectionDialogProfile> | undefined {
        return this.getActiveFormComponents().includes(propertyName)
            ? this.state.connectionComponents.components[propertyName]
            : undefined;
    }

    private async getAccounts(): Promise<FormItemOptions[]> {
        const accounts =
            await this._mainController.azureAccountService.getAccounts();
        return accounts.map((account) => {
            return {
                displayName: account.displayInfo.displayName,
                value: account.displayInfo.userId,
            };
        });
    }

    private async getTenants(accountId: string): Promise<FormItemOptions[]> {
        const account = (
            await this._mainController.azureAccountService.getAccounts()
        ).find((account) => account.displayInfo.userId === accountId);
        if (!account) {
            return [];
        }
        const tenants = account.properties.tenants;
        if (!tenants) {
            return [];
        }
        return tenants.map((tenant) => {
            return {
                displayName: tenant.displayName,
                value: tenant.id,
            };
        });
    }

    private convertToFormComponent(
        connOption: ConnectionOption,
    ): FormItemSpec<IConnectionDialogProfile> {
        switch (connOption.valueType) {
            case "boolean":
                return {
                    propertyName:
                        connOption.name as keyof IConnectionDialogProfile,
                    label: connOption.displayName,
                    required: connOption.isRequired,
                    type: FormItemType.Checkbox,
                    tooltip: connOption.description,
                };
            case "string":
                return {
                    propertyName:
                        connOption.name as keyof IConnectionDialogProfile,
                    label: connOption.displayName,
                    required: connOption.isRequired,
                    type: FormItemType.Input,
                    tooltip: connOption.description,
                };
            case "password":
                return {
                    propertyName:
                        connOption.name as keyof IConnectionDialogProfile,
                    label: connOption.displayName,
                    required: connOption.isRequired,
                    type: FormItemType.Password,
                    tooltip: connOption.description,
                };

            case "number":
                return {
                    propertyName:
                        connOption.name as keyof IConnectionDialogProfile,
                    label: connOption.displayName,
                    required: connOption.isRequired,
                    type: FormItemType.Input,
                    tooltip: connOption.description,
                };
            case "category":
                return {
                    propertyName:
                        connOption.name as keyof IConnectionDialogProfile,
                    label: connOption.displayName,
                    required: connOption.isRequired,
                    type: FormItemType.Dropdown,
                    tooltip: connOption.description,
                    options: connOption.categoryValues.map((v) => {
                        return {
                            displayName: v.displayName ?? v.name, // Use name if displayName is not provided
                            value: v.name,
                        };
                    }),
                };
            default:
                const error = `Unhandled connection option type: ${connOption.valueType}`;
                ConnectionDialogWebviewController._logger.log(error);
                sendErrorEvent(
                    TelemetryViews.ConnectionDialog,
                    TelemetryActions.LoadConnectionProperties,
                    new Error(error),
                    true, // includeErrorMessage
                );
        }
    }

    private async completeFormComponents(
        components: Partial<
            Record<keyof IConnectionDialogProfile, ConnectionDialogFormItemSpec>
        >,
    ) {
        // Add additional components that are not part of the connection options
        components["profileName"] = {
            propertyName: "profileName",
            label: Loc.profileName,
            required: false,
            type: FormItemType.Input,
            isAdvancedOption: false,
        };

        components["savePassword"] = {
            propertyName: "savePassword",
            label: Loc.savePassword,
            required: false,
            type: FormItemType.Checkbox,
            isAdvancedOption: false,
        };

        components["accountId"] = {
            propertyName: "accountId",
            label: Loc.azureAccount,
            required: true,
            type: FormItemType.Dropdown,
            options: await this.getAccounts(),
            placeholder: Loc.selectAnAccount,
            actionButtons: await this.getAzureActionButtons(),
            validate: (value: string) => {
                if (
                    this.state.connectionProfile.authenticationType ===
                        AuthenticationType.AzureMFA &&
                    !value
                ) {
                    return {
                        isValid: false,
                        validationMessage: Loc.azureAccountIsRequired,
                    };
                }
                return {
                    isValid: true,
                    validationMessage: "",
                };
            },
            isAdvancedOption: false,
        };

        components["tenantId"] = {
            propertyName: "tenantId",
            label: Loc.tenantId,
            required: true,
            type: FormItemType.Dropdown,
            options: [],
            hidden: true,
            placeholder: Loc.selectATenant,
            validate: (value: string) => {
                if (
                    this.state.connectionProfile.authenticationType ===
                        AuthenticationType.AzureMFA &&
                    !value
                ) {
                    return {
                        isValid: false,
                        validationMessage: Loc.tenantIdIsRequired,
                    };
                }
                return {
                    isValid: true,
                    validationMessage: "",
                };
            },
            isAdvancedOption: false,
        };

        components["connectionString"] = {
            type: FormItemType.TextArea,
            propertyName: "connectionString",
            label: Loc.connectionString,
            required: true,
            validate: (value: string) => {
                if (
                    this.state.selectedInputMode ===
                        ConnectionInputMode.ConnectionString &&
                    !value
                ) {
                    return {
                        isValid: false,
                        validationMessage: Loc.connectionStringIsRequired,
                    };
                }
                return {
                    isValid: true,
                    validationMessage: "",
                };
            },
            isAdvancedOption: false,
        };

        // add missing validation functions for generated components
        components["server"].validate = (value: string) => {
            if (
                this.state.connectionProfile.authenticationType ===
                    AuthenticationType.SqlLogin &&
                !value
            ) {
                return {
                    isValid: false,
                    validationMessage: Loc.usernameIsRequired,
                };
            }
            return {
                isValid: true,
                validationMessage: "",
            };
        };

        components["user"].validate = (value: string) => {
            if (
                this.state.connectionProfile.authenticationType ===
                    AuthenticationType.SqlLogin &&
                !value
            ) {
                return {
                    isValid: false,
                    validationMessage: Loc.usernameIsRequired,
                };
            }
            return {
                isValid: true,
                validationMessage: "",
            };
        };
    }

    private async generateConnectionComponents(): Promise<
        Record<keyof IConnectionDialogProfile, ConnectionDialogFormItemSpec>
    > {
        // get list of connection options from Tools Service
        const capabilitiesResult: CapabilitiesResult =
            await this._mainController.connectionManager.client.sendRequest(
                GetCapabilitiesRequest.type,
                {},
            );
        const connectionOptions: ConnectionOption[] =
            capabilitiesResult.capabilities.connectionProvider.options;

        const result: Record<
            keyof IConnectionDialogProfile,
            ConnectionDialogFormItemSpec
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        > = {} as any; // force empty record for intial blank state

        for (const option of connectionOptions) {
            result[option.name as keyof IConnectionDialogProfile] = {
                ...this.convertToFormComponent(option),
                isAdvancedOption: !this._mainOptionNames.has(option.name),
                optionCategory: option.groupName,
            };
        }

        await this.completeFormComponents(result);

        return result;
    }

    private groupAdvancedOptions({
        components,
        mainOptions,
        topAdvancedOptions,
    }: {
        components: Partial<
            Record<keyof IConnectionDialogProfile, ConnectionDialogFormItemSpec>
        >;
        mainOptions: (keyof IConnectionDialogProfile)[];
        topAdvancedOptions: (keyof IConnectionDialogProfile)[];
    }): Record<string, (keyof IConnectionDialogProfile)[]> {
        const result = {};

        for (const component of Object.values(components)) {
            if (
                component.isAdvancedOption &&
                !mainOptions.includes(component.propertyName) &&
                !topAdvancedOptions.includes(component.propertyName)
            ) {
                if (!result[component.optionCategory]) {
                    result[component.optionCategory] = [component.propertyName];
                } else {
                    result[component.optionCategory].push(
                        component.propertyName,
                    );
                }
            }
        }

        return result;
    }

    private _mainOptionNames = new Set<string>([
        "server",
        "authenticationType",
        "user",
        "password",
        "savePassword",
        "accountId",
        "tenantId",
        "database",
        "trustServerCertificate",
        "encrypt",
        "profileName",
    ]);

    private async validateFormComponents(
        propertyName?: keyof IConnectionDialogProfile,
    ): Promise<number> {
        let errorCount = 0;
        if (propertyName) {
            const component = this.getFormComponent(propertyName);
            if (component && component.validate) {
                component.validation = component.validate(
                    this.state.connectionProfile[propertyName],
                );
                if (!component.validation.isValid) {
                    return 1;
                }
            }
        } else {
            this.getActiveFormComponents()
                .map((x) => this.state.connectionComponents.components[x])
                .forEach((c) => {
                    if (c.hidden) {
                        c.validation = {
                            isValid: true,
                            validationMessage: "",
                        };
                        return;
                    } else {
                        if (c.validate) {
                            c.validation = c.validate(
                                this.state.connectionProfile[c.propertyName],
                            );
                            if (!c.validation.isValid) {
                                errorCount++;
                            }
                        }
                    }
                });
        }
        return errorCount;
    }

    private async getAzureActionButtons(): Promise<FormItemActionButton[]> {
        const actionButtons: FormItemActionButton[] = [];
        actionButtons.push({
            label: Loc.signIn,
            id: "azureSignIn",
            callback: async () => {
                const account =
                    await this._mainController.azureAccountService.addAccount();
                const accountsComponent = this.getFormComponent("accountId");
                if (accountsComponent) {
                    accountsComponent.options = await this.getAccounts();
                    this.state.connectionProfile.accountId = account.key.id;
                    this.updateState();
                    await this.handleAzureMFAEdits("accountId");
                }
            },
        });
        if (
            this.state.connectionProfile.authenticationType ===
                AuthenticationType.AzureMFA &&
            this.state.connectionProfile.accountId
        ) {
            const account = (
                await this._mainController.azureAccountService.getAccounts()
            ).find(
                (account) =>
                    account.displayInfo.userId ===
                    this.state.connectionProfile.accountId,
            );
            if (account) {
                const session =
                    await this._mainController.azureAccountService.getAccountSecurityToken(
                        account,
                        undefined,
                    );
                const isTokenExpired = AzureController.isTokenInValid(
                    session.token,
                    session.expiresOn,
                );
                if (isTokenExpired) {
                    actionButtons.push({
                        label: refreshTokenLabel,
                        id: "refreshToken",
                        callback: async () => {
                            const account = (
                                await this._mainController.azureAccountService.getAccounts()
                            ).find(
                                (account) =>
                                    account.displayInfo.userId ===
                                    this.state.connectionProfile.accountId,
                            );
                            if (account) {
                                const session =
                                    await this._mainController.azureAccountService.getAccountSecurityToken(
                                        account,
                                        undefined,
                                    );
                                ConnectionDialogWebviewController._logger.log(
                                    "Token refreshed",
                                    session.expiresOn,
                                );
                            }
                        },
                    });
                }
            }
        }
        return actionButtons;
    }

    private async handleAzureMFAEdits(
        propertyName: keyof IConnectionDialogProfile,
    ) {
        const mfaComponents: (keyof IConnectionDialogProfile)[] = [
            "accountId",
            "tenantId",
            "authenticationType",
        ];
        if (mfaComponents.includes(propertyName)) {
            if (
                this.state.connectionProfile.authenticationType !==
                AuthenticationType.AzureMFA
            ) {
                return;
            }
            const accountComponent = this.getFormComponent("accountId");
            const tenantComponent = this.getFormComponent("tenantId");
            let tenants: FormItemOptions[] = [];
            switch (propertyName) {
                case "accountId":
                    tenants = await this.getTenants(
                        this.state.connectionProfile.accountId,
                    );
                    if (tenantComponent) {
                        tenantComponent.options = tenants;
                        if (tenants && tenants.length > 0) {
                            this.state.connectionProfile.tenantId =
                                tenants[0].value;
                        }
                    }
                    accountComponent.actionButtons =
                        await this.getAzureActionButtons();
                    break;
                case "tenantId":
                    break;
                case "authenticationType":
                    const firstOption = accountComponent.options[0];
                    if (firstOption) {
                        this.state.connectionProfile.accountId =
                            firstOption.value;
                    }
                    tenants = await this.getTenants(
                        this.state.connectionProfile.accountId,
                    );
                    if (tenantComponent) {
                        tenantComponent.options = tenants;
                        if (tenants && tenants.length > 0) {
                            this.state.connectionProfile.tenantId =
                                tenants[0].value;
                        }
                    }
                    accountComponent.actionButtons =
                        await this.getAzureActionButtons();
                    break;
            }
        }
    }

    private clearFormError() {
        this.state.formError = "";
        for (const component of this.getActiveFormComponents().map(
            (x) => this.state.connectionComponents.components[x],
        )) {
            component.validation = undefined;
        }
    }

    private registerRpcHandlers() {
        this.registerReducer(
            "setConnectionInputType",
            async (state, payload) => {
                this.state.selectedInputMode = payload.inputMode;
                await this.updateItemVisibility();
                this.updateState();

                if (
                    this.state.selectedInputMode ===
                    ConnectionInputMode.AzureBrowse
                ) {
                    await this.loadAllAzureServers(state);
                }

                return state;
            },
        );

        this.registerReducer("formAction", async (state, payload) => {
            if (payload.event.isAction) {
                const component = this.getFormComponent(
                    payload.event.propertyName,
                );
                if (component && component.actionButtons) {
                    const actionButton = component.actionButtons.find(
                        (b) => b.id === payload.event.value,
                    );
                    if (actionButton?.callback) {
                        await actionButton.callback();
                    }
                }
            } else {
                (this.state.connectionProfile[
                    payload.event.propertyName
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ] as any) = payload.event.value;
                await this.validateFormComponents(payload.event.propertyName);
                await this.handleAzureMFAEdits(payload.event.propertyName);
            }
            await this.updateItemVisibility();

            return state;
        });

        this.registerReducer("loadConnection", async (state, payload) => {
            sendActionEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.LoadConnection,
            );

            this._connectionToEditCopy = structuredClone(payload.connection);
            this.clearFormError();
            this.state.connectionProfile = payload.connection;

            this.state.selectedInputMode = this._connectionToEditCopy
                .connectionString
                ? ConnectionInputMode.ConnectionString
                : ConnectionInputMode.Parameters;
            await this.updateItemVisibility();
            await this.handleAzureMFAEdits("azureAuthType");
            await this.handleAzureMFAEdits("accountId");

            return state;
        });

        this.registerReducer("connect", async (state) => {
            this.clearFormError();
            this.state.connectionStatus = ApiStatus.Loading;
            this.state.formError = "";
            this.updateState();

            // Clear the options that aren't being used (due to form selections, like authType)
            for (const option of Object.values(
                this.state.connectionComponents.components,
            )) {
                if (option.hidden) {
                    (this.state.connectionProfile[
                        option.propertyName as keyof IConnectionDialogProfile
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ] as any) = undefined;
                }
            }

            // Perform final validation of all inputs
            const errorCount = await this.validateFormComponents();
            if (errorCount > 0) {
                this.state.connectionStatus = ApiStatus.Error;
                return state;
            }

            try {
                try {
                    const result =
                        await this._mainController.connectionManager.connectionUI.validateAndSaveProfileFromDialog(
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            this.state.connectionProfile as any,
                        );

                    if (result.errorMessage) {
                        if (
                            result.errorNumber ===
                            connectionCertValidationFailedErrorCode
                        ) {
                            this.state.connectionStatus = ApiStatus.Error;
                            this.state.trustServerCertError =
                                result.errorMessage;

                            // connection failing because the user didn't trust the server cert is not an error worth logging;
                            // just prompt the user to trust the cert

                            return state;
                        }

                        this.state.formError = result.errorMessage;
                        this.state.connectionStatus = ApiStatus.Error;

                        sendActionEvent(
                            TelemetryViews.ConnectionDialog,
                            TelemetryActions.CreateConnection,
                            {
                                result: "connectionError",
                                errorNumber: String(result.errorNumber),
                                newOrEditedConnection: this
                                    ._connectionToEditCopy
                                    ? "edited"
                                    : "new",
                                connectionInputType:
                                    this.state.selectedInputMode,
                                authMode:
                                    this.state.connectionProfile
                                        .authenticationType,
                            },
                        );

                        return state;
                    }
                } catch (error) {
                    this.state.formError = getErrorMessage(error);
                    this.state.connectionStatus = ApiStatus.Error;

                    sendErrorEvent(
                        TelemetryViews.ConnectionDialog,
                        TelemetryActions.CreateConnection,
                        error,
                        false, // includeErrorMessage
                        undefined, // errorCode
                        undefined, // errorType
                        {
                            connectionInputType: this.state.selectedInputMode,
                            authMode:
                                this.state.connectionProfile.authenticationType,
                        },
                    );

                    return state;
                }

                sendActionEvent(
                    TelemetryViews.ConnectionDialog,
                    TelemetryActions.CreateConnection,
                    {
                        result: "success",
                        newOrEditedConnection: this._connectionToEditCopy
                            ? "edited"
                            : "new",
                        connectionInputType: this.state.selectedInputMode,
                        authMode:
                            this.state.connectionProfile.authenticationType,
                    },
                );

                if (this._connectionToEditCopy) {
                    await this._mainController.connectionManager.getUriForConnection(
                        this._connectionToEditCopy,
                    );
                    await this._objectExplorerProvider.removeConnectionNodes([
                        this._connectionToEditCopy,
                    ]);

                    await this._mainController.connectionManager.connectionStore.removeProfile(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        this._connectionToEditCopy as any,
                    );
                    this._objectExplorerProvider.refresh(undefined);
                }

                await this._mainController.connectionManager.connectionUI.saveProfile(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    this.state.connectionProfile as any,
                );
                const node =
                    await this._mainController.createObjectExplorerSessionFromDialog(
                        this.state.connectionProfile,
                    );

                this._objectExplorerProvider.refresh(undefined);
                state.recentConnections = await this.loadRecentConnections();
                this.updateState();
                this.state.connectionStatus = ApiStatus.Loaded;
                await this._mainController.objectExplorerTree.reveal(node, {
                    focus: true,
                    select: true,
                    expand: true,
                });
                await this.panel.dispose();
                await UserSurvey.getInstance().promptUserForNPSFeedback();
            } catch (error) {
                this.state.connectionStatus = ApiStatus.Error;

                sendErrorEvent(
                    TelemetryViews.ConnectionDialog,
                    TelemetryActions.CreateConnection,
                    error,
                    undefined, // includeErrorMessage
                    undefined, // errorCode
                    undefined, // errorType
                    {
                        connectionInputType: this.state.selectedInputMode,
                        authMode:
                            this.state.connectionProfile.authenticationType,
                    },
                );

                return state;
            }
            return state;
        });

        this.registerReducer("loadAzureServers", async (state, payload) => {
            await this.loadAzureServersForSubscription(
                state,
                payload.subscriptionId,
            );

            return state;
        });

        this.registerReducer("cancelTrustServerCertDialog", async (state) => {
            state.trustServerCertError = undefined;
            return state;
        });

        this.registerReducer("refreshMruConnections", async (state) => {
            state.recentConnections = await this.loadRecentConnections();
            this.updateState();

            return state;
        });

        this.registerReducer("filterAzureSubscriptions", async (state) => {
            await promptForAzureSubscriptionFilter(state);
            await this.loadAllAzureServers(state);

            return state;
        });
    }

    private async loadAzureSubscriptions(
        state: ConnectionDialogWebviewState,
    ): Promise<Map<string, AzureSubscription[]> | undefined> {
        let endActivity: ActivityObject;
        try {
            const auth = await confirmVscodeAzureSignin();

            if (!auth) {
                state.formError = l10n.t("Azure sign in failed.");
                return undefined;
            }

            state.loadingAzureSubscriptionsStatus = ApiStatus.Loading;
            this.updateState();

            // getSubscriptions() below checks this config setting if filtering is specified.  If the user has this set, then we use it; if not, we get all subscriptions.
            // The specific vscode config setting it uses is hardcoded into the VS Code Azure SDK, so we need to use the same value here.
            const shouldUseFilter =
                vscode.workspace
                    .getConfiguration()
                    .get<
                        string[] | undefined
                    >(azureSubscriptionFilterConfigKey) !== undefined;

            endActivity = startActivity(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.LoadAzureSubscriptions,
            );

            this._azureSubscriptions = new Map(
                (await auth.getSubscriptions(shouldUseFilter)).map((s) => [
                    s.subscriptionId,
                    s,
                ]),
            );
            const tenantSubMap = this.groupBy<string, AzureSubscription>(
                Array.from(this._azureSubscriptions.values()),
                "tenantId",
            ); // TODO: replace with Object.groupBy once ES2024 is supported

            const subs: AzureSubscriptionInfo[] = [];

            for (const t of tenantSubMap.keys()) {
                for (const s of tenantSubMap.get(t)) {
                    subs.push({
                        id: s.subscriptionId,
                        name: s.name,
                        loaded: false,
                    });
                }
            }

            state.azureSubscriptions = subs;
            state.loadingAzureSubscriptionsStatus = ApiStatus.Loaded;

            endActivity.end(
                ActivityStatus.Succeeded,
                undefined, // additionalProperties
                {
                    subscriptionCount: subs.length,
                },
            );
            this.updateState();

            return tenantSubMap;
        } catch (error) {
            state.formError = l10n.t("Error loading Azure subscriptions.");
            state.loadingAzureSubscriptionsStatus = ApiStatus.Error;
            console.error(state.formError + "\n" + getErrorMessage(error));
            endActivity.endFailed(error, false);
            return undefined;
        }
    }

    private async loadAllAzureServers(
        state: ConnectionDialogWebviewState,
    ): Promise<void> {
        const endActivity = startActivity(
            TelemetryViews.ConnectionDialog,
            TelemetryActions.LoadAzureServers,
        );
        try {
            const tenantSubMap = await this.loadAzureSubscriptions(state);

            if (!tenantSubMap) {
                return;
            }

            if (tenantSubMap.size === 0) {
                state.formError = l10n.t(
                    "No subscriptions available.  Adjust your subscription filters to try again.",
                );
            } else {
                state.loadingAzureServersStatus = ApiStatus.Loading;
                state.azureServers = [];
                this.updateState();
                const promiseArray: Promise<void>[] = [];
                for (const t of tenantSubMap.keys()) {
                    for (const s of tenantSubMap.get(t)) {
                        promiseArray.push(
                            this.loadAzureServersForSubscription(
                                state,
                                s.subscriptionId,
                            ),
                        );
                    }
                }
                await Promise.all(promiseArray);
                endActivity.end(
                    ActivityStatus.Succeeded,
                    undefined, // additionalProperties
                    {
                        subscriptionCount: promiseArray.length,
                    },
                );

                state.loadingAzureServersStatus = ApiStatus.Loaded;
                return;
            }
        } catch (error) {
            state.formError = l10n.t("Error loading Azure databases.");
            state.loadingAzureServersStatus = ApiStatus.Error;
            console.error(state.formError + "\n" + getErrorMessage(error));

            endActivity.endFailed(
                error,
                false, // includeErrorMessage
            );
            return;
        }
    }

    private async loadAzureServersForSubscription(
        state: ConnectionDialogWebviewState,
        subscriptionId: string,
    ) {
        const azSub = this._azureSubscriptions.get(subscriptionId);
        const stateSub = state.azureSubscriptions.find(
            (s) => s.id === subscriptionId,
        );

        try {
            const servers = await fetchServersFromAzure(azSub);
            state.azureServers.push(...servers);
            stateSub.loaded = true;
            this.updateState();
            console.log(
                `Loaded ${servers.length} servers for subscription ${azSub.name} (${azSub.subscriptionId})`,
            );
        } catch (error) {
            console.error(
                Loc.errorLoadingAzureDatabases(
                    azSub.name,
                    azSub.subscriptionId,
                ),
                +"\n" + getErrorMessage(error),
            );

            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.LoadAzureServers,
                error,
                true, // includeErrorMessage
                undefined, // errorCode
                undefined, // errorType
            );
        }
    }

    private groupBy<K, V>(xs: V[], key: string): Map<K, V[]> {
        return xs.reduce((rv, x) => {
            const keyValue = x[key] as K;
            if (!rv.has(keyValue)) {
                rv.set(keyValue, []);
            }
            rv.get(keyValue)!.push(x);
            return rv;
        }, new Map<K, V[]>());
    }
}
