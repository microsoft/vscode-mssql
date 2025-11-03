/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import * as mssql from "vscode-mssql";
import * as constants from "../constants/constants";
import { FormWebviewController } from "../forms/formWebviewController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import ConnectionManager, { ConnectionSuccessfulEvent } from "../controllers/connectionManager";
import { IConnectionProfile } from "../models/interfaces";
import { PublishProject as Loc } from "../constants/locConstants";
import {
    PublishDialogReducers,
    PublishDialogFormItemSpec,
    IPublishForm,
    PublishFormFields,
    PublishFormContainerFields,
    PublishDialogState,
    PublishTarget,
} from "../sharedInterfaces/publishDialog";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { generatePublishFormComponents } from "./formComponentHelpers";
import { parsePublishProfileXml, readProjectProperties } from "./projectUtils";
import { SqlProjectsService } from "../services/sqlProjectsService";
import { Deferred } from "../protocol";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";
import { getSqlServerContainerTagsForTargetVersion } from "../deployment/dockerUtils";
import { hasAnyMissingRequiredValues, getErrorMessage } from "../utils/utils";

export class PublishProjectWebViewController extends FormWebviewController<
    IPublishForm,
    PublishDialogState,
    PublishDialogFormItemSpec,
    PublishDialogReducers
> {
    private _cachedDatabaseList?: { displayName: string; value: string }[];
    private _cachedSelectedDatabase?: string;
    public readonly initialized: Deferred<void> = new Deferred<void>();
    private readonly _sqlProjectsService?: SqlProjectsService;
    private readonly _dacFxService?: mssql.IDacFxService;
    private readonly _connectionManager: ConnectionManager;

    constructor(
        context: vscode.ExtensionContext,
        _vscodeWrapper: VscodeWrapper,
        connectionManager: ConnectionManager,
        projectFilePath: string,
        sqlProjectsService?: SqlProjectsService,
        dacFxService?: mssql.IDacFxService,
        deploymentOptions?: mssql.DeploymentOptions,
    ) {
        super(
            context,
            _vscodeWrapper,
            "publishProject",
            "publishProject",
            {
                formState: {
                    publishProfilePath: "",
                    serverName: "",
                    databaseName: path.basename(projectFilePath, path.extname(projectFilePath)),
                    publishTarget: PublishTarget.ExistingServer,
                    sqlCmdVariables: {},
                },
                formComponents: {},
                projectFilePath,
                inProgress: false,
                lastPublishResult: undefined,
                hasFormErrors: true,
                deploymentOptions: deploymentOptions,
                defaultDeploymentOptions: deploymentOptions
                    ? structuredClone(deploymentOptions)
                    : undefined,
                waitingForNewConnection: false,
            } as PublishDialogState,
            {
                title: Loc.Title,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "schemaCompare_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "schemaCompare_light.svg",
                    ),
                },
            },
        );

        // Clear default excludeObjectTypes for publish dialog, no default exclude options should exist
        if (deploymentOptions?.excludeObjectTypes !== undefined) {
            deploymentOptions.excludeObjectTypes.value = [];
        }

        this._sqlProjectsService = sqlProjectsService;
        this._dacFxService = dacFxService;
        this._connectionManager = connectionManager;

        this.registerRpcHandlers();

        // Listen for successful connections
        this.registerDisposable(
            this._connectionManager.onSuccessfulConnection(async (event) => {
                // Only auto-populate if waiting for a new connection
                if (this.state.waitingForNewConnection) {
                    // Auto-populate form fields from the successful connection event
                    await this.handleSuccessfulConnection(event);
                }
            }),
        );

        void this.initializeDialog(projectFilePath)
            .then(() => {
                this.updateState();
                this.initialized.resolve();
            })
            .catch((err) => {
                this.initialized.reject(err);
            });
    }

    private async initializeDialog(projectFilePath: string) {
        if (projectFilePath) {
            this.state.projectFilePath = projectFilePath;
        }

        // Get the project properties from the proj file
        let projectTargetVersion: string | undefined;
        try {
            if (this._sqlProjectsService && projectFilePath) {
                const props = await readProjectProperties(
                    this._sqlProjectsService,
                    projectFilePath,
                );
                if (props) {
                    this.state.projectProperties = props;
                    projectTargetVersion = props.targetVersion;
                }
            }
        } catch (error) {
            // Log error and send telemetry, but keep dialog resilient
            console.error("Failed to read project properties:", error);
            sendErrorEvent(
                TelemetryViews.SqlProjects,
                TelemetryActions.PublishProjectChanges,
                error instanceof Error ? error : new Error(String(error)),
                false,
            );
        }

        // Load publish form components
        this.state.formComponents = generatePublishFormComponents(
            projectTargetVersion,
            this.state.formState.databaseName,
        );

        this.updateState();

        // Fetch Docker tags for the container image dropdown
        const tagComponent = this.state.formComponents[PublishFormFields.ContainerImageTag];
        if (tagComponent) {
            try {
                const tagOptions =
                    await getSqlServerContainerTagsForTargetVersion(projectTargetVersion);
                if (tagOptions && tagOptions.length > 0) {
                    tagComponent.options = tagOptions;

                    // Set default to first option (most recent -latest) if not already set
                    if (!this.state.formState.containerImageTag && tagOptions[0]) {
                        this.state.formState.containerImageTag = tagOptions[0].value;
                    }
                }
            } catch (error) {
                console.error("Failed to fetch Docker container tags:", error);
            }
        }

        void this.updateItemVisibility();

        // Run initial validation to set hasFormErrors state for button enablement
        await this.validateForm(this.state.formState, undefined, true);
    }

    private registerRpcHandlers(): void {
        this.registerReducer("openConnectionDialog", async (state: PublishDialogState) => {
            // Set waiting state to detect new connections
            state.waitingForNewConnection = true;
            this.updateState(state);

            // Execute the command to open the connection dialog
            void vscode.commands.executeCommand(constants.cmdAddObjectExplorer);

            return state;
        });

        this.registerReducer("publishNow", async (state: PublishDialogState) => {
            // TODO: implement actual publish logic (currently just clears inProgress)
            return { ...state, inProgress: false };
        });

        this.registerReducer("generatePublishScript", async (state) => {
            // TODO: implement script generation logic
            return state;
        });

        this.registerReducer(
            "updateDeploymentOptions",
            async (
                state: PublishDialogState,
                payload: { deploymentOptions: mssql.DeploymentOptions },
            ) => {
                // Update deployment options and regenerate grouped options for UI
                const newState = {
                    ...state,
                    deploymentOptions: payload.deploymentOptions,
                };

                return newState;
            },
        );

        this.registerReducer("selectPublishProfile", async (state: PublishDialogState) => {
            // Derive project folder path from the project file path
            const projectFolderPath = state.projectFilePath
                ? path.dirname(state.projectFilePath)
                : undefined;

            // Open browse dialog to select the publish.xml file
            const fileUris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                defaultUri: projectFolderPath ? vscode.Uri.file(projectFolderPath) : undefined,
                openLabel: Loc.SelectPublishProfile,
                filters: {
                    [Loc.PublishSettingsFile]: [constants.PublishProfileExtension],
                },
            });

            if (fileUris?.length > 0) {
                const selectedPath = fileUris[0].fsPath;

                try {
                    // Parse the profile XML to extract all values, including deployment options from DacFx service
                    const parsedProfile = await parsePublishProfileXml(
                        selectedPath,
                        this._dacFxService,
                    );

                    // Send telemetry for profile loaded
                    sendActionEvent(
                        TelemetryViews.SqlProjects,
                        TelemetryActions.PublishProfileLoaded,
                    );

                    // Update state with all parsed values - UI components will consume when available
                    const newState = {
                        ...state,
                        formState: {
                            ...state.formState,
                            publishProfilePath: selectedPath,
                            databaseName:
                                parsedProfile.databaseName || state.formState.databaseName,
                            serverName: parsedProfile.serverName || state.formState.serverName,
                            sqlCmdVariables: parsedProfile.sqlCmdVariables,
                        },
                        connectionString: parsedProfile.connectionString || state.connectionString,
                        deploymentOptions:
                            parsedProfile.deploymentOptions || state.deploymentOptions,
                        formMessage: !this._dacFxService
                            ? {
                                  message: Loc.DacFxServiceNotAvailableProfileLoaded,
                                  intent: "warning" as const,
                              }
                            : undefined,
                    };

                    return newState;
                } catch (error) {
                    return {
                        ...state,
                        formMessage: {
                            message: `${Loc.PublishProfileLoadFailed}: ${error}`,
                            intent: "error",
                        },
                    };
                }
            }

            return state;
        });

        this.registerReducer("closeMessage", async (state: PublishDialogState) => {
            return { ...state, formMessage: undefined };
        });

        this.registerReducer(
            "savePublishProfile",
            async (state: PublishDialogState, _payload: { publishProfileName: string }) => {
                // Derive project folder path and name from the project file path
                const projectFolderPath = state.projectFilePath
                    ? path.dirname(state.projectFilePath)
                    : ".";
                const projectName = state.projectFilePath
                    ? path.basename(state.projectFilePath, path.extname(state.projectFilePath))
                    : "project";

                // Use selected profile path if available, otherwise save as projectName
                const defaultPath = state.formState.publishProfilePath
                    ? vscode.Uri.file(state.formState.publishProfilePath)
                    : vscode.Uri.file(
                          path.join(
                              projectFolderPath,
                              `${projectName}.${constants.PublishProfileExtension}`,
                          ),
                      );

                // Open save dialog with default name
                const fileUri = await vscode.window.showSaveDialog({
                    defaultUri: defaultPath,
                    saveLabel: Loc.SaveAs,
                    filters: {
                        [Loc.PublishSettingsFile]: [constants.PublishProfileExtension],
                    },
                });

                if (!fileUri) {
                    return state; // User cancelled
                }

                // Save the profile using DacFx service
                if (!this._dacFxService) {
                    return {
                        ...state,
                        formMessage: {
                            message: Loc.DacFxServiceNotAvailable,
                            intent: "error",
                        },
                    };
                }

                try {
                    const databaseName = state.formState.databaseName || projectName;
                    // Connection string depends on publish target:
                    // - For container targets: empty string because we're provisioning a new container
                    //   and don't have an existing connection. The actual connection would be established
                    //   after the container is created and SQL Server is running inside it.
                    // - For existing servers: use the current connection string from the established connection
                    const connectionString =
                        state.formState.publishTarget === PublishTarget.LocalContainer
                            ? ""
                            : state.connectionString || "";
                    const sqlCmdVariables = new Map(
                        Object.entries(state.formState.sqlCmdVariables || {}),
                    );

                    await this._dacFxService.savePublishProfile(
                        fileUri.fsPath,
                        databaseName,
                        connectionString,
                        sqlCmdVariables,
                        state.deploymentOptions,
                    );

                    sendActionEvent(
                        TelemetryViews.SqlProjects,
                        TelemetryActions.PublishProfileSaved,
                    );

                    return {
                        ...state,
                        formMessage: {
                            message: Loc.PublishProfileSavedSuccessfully(fileUri.fsPath),
                            intent: "success",
                        },
                    };
                } catch (error) {
                    return {
                        ...state,
                        formMessage: {
                            message: `${Loc.PublishProfileSaveFailed}: ${error}`,
                            intent: "error",
                        },
                    };
                }

                return state;
            },
        );
    }

    /**
     * Handle successful connection event and populate form fields with connection details, such as server name and database list.
     * @param event The connection successful event containing connection details
     */
    private async handleSuccessfulConnection(event: ConnectionSuccessfulEvent): Promise<void> {
        try {
            const connection = event.connection;
            if (!connection || !connection.credentials) {
                return;
            }

            const connectionProfile = connection.credentials as IConnectionProfile;
            if (!connectionProfile || !connectionProfile.server) {
                return;
            }

            this.state.formState.serverName = connectionProfile.server;
            this.state.connectionString = await this._connectionManager.getConnectionString(
                event.fileUri,
                true, // includePassword
                true, // includeApplicationName
            );

            // Get databases
            try {
                const databases = await this._connectionManager.listDatabases(event.fileUri);

                // Update database dropdown options
                const databaseComponent = this.state.formComponents[PublishFormFields.DatabaseName];
                if (databaseComponent) {
                    databaseComponent.options = databases.map((db) => ({
                        displayName: db,
                        value: db,
                    }));
                }

                // Optionally select the first database if available
                if (databases.length > 0 && !this.state.formState.databaseName) {
                    this.state.formState.databaseName = databases[0];
                }
            } catch (dbError) {
                // Show error message to user when database listing fails
                this.state.formMessage = {
                    message: `${Loc.FailedToListDatabases}: ${getErrorMessage(dbError)}`,
                    intent: "error",
                };

                // Log the error for diagnostics
                sendActionEvent(
                    TelemetryViews.SqlProjects,
                    TelemetryActions.PublishProjectConnectionError,
                    { error: dbError instanceof Error ? dbError.message : String(dbError) },
                );
            }

            // Validate form to update button state after connection
            await this.validateForm(this.state.formState, undefined, false);
        } catch (err) {
            // Log the error for diagnostics
            sendActionEvent(
                TelemetryViews.SqlProjects,
                TelemetryActions.PublishProjectConnectionError,
                { error: err instanceof Error ? err.message : String(err) },
            );
        } finally {
            // Reset the waiting state
            this.state.waitingForNewConnection = false;

            // Update UI to reflect all state changes (connection success, errors, and waiting state reset)
            this.updateState();
        }
    }

    protected getActiveFormComponents(state: PublishDialogState): (keyof IPublishForm)[] {
        const activeComponents: (keyof IPublishForm)[] = [
            PublishFormFields.PublishTarget,
            PublishFormFields.PublishProfilePath,
            PublishFormFields.ServerName,
            PublishFormFields.DatabaseName,
        ];

        if (state.formState.publishTarget === PublishTarget.LocalContainer) {
            activeComponents.push(...PublishFormContainerFields);
        }

        return activeComponents;
    }

    /**
     * Called after a form property is set and validated.
     * Handles publish target changes for both validation and database dropdown management.
     */
    public async afterSetFormProperty(propertyName: keyof IPublishForm): Promise<void> {
        if (propertyName === PublishFormFields.PublishTarget) {
            const databaseComponent = this.state.formComponents[PublishFormFields.DatabaseName];
            if (!databaseComponent) return;

            if (this.state.formState.publishTarget === PublishTarget.LocalContainer) {
                // Cache and clear for container mode
                if (databaseComponent.options?.length) {
                    this._cachedDatabaseList = databaseComponent.options;
                    this._cachedSelectedDatabase = this.state.formState.databaseName;
                }
                databaseComponent.options = [];
                this.state.formState.databaseName = path.basename(
                    this.state.projectFilePath,
                    path.extname(this.state.projectFilePath),
                );
                this.state.connectionString = undefined;
            } else if (this.state.formState.publishTarget === PublishTarget.ExistingServer) {
                // Restore for server mode
                if (this._cachedDatabaseList?.length) {
                    databaseComponent.options = this._cachedDatabaseList;
                    if (this._cachedSelectedDatabase) {
                        this.state.formState.databaseName = this._cachedSelectedDatabase;
                    }
                }
            }

            await this.updateItemVisibility();
            await this.validateForm(this.state.formState, undefined, false);
            this.updateState();
        }
    }

    public updateItemVisibility(state?: PublishDialogState): Promise<void> {
        const currentState = state || this.state;
        const target = currentState.formState?.publishTarget;
        const hidden: string[] = [];

        if (target === PublishTarget.LocalContainer) {
            // Container deployment: hide server name field
            hidden.push(PublishFormFields.ServerName);
        } else if (
            target === PublishTarget.ExistingServer ||
            target === PublishTarget.NewAzureServer
        ) {
            // Existing server or new Azure server: hide container-specific fields
            hidden.push(...PublishFormContainerFields);
        }

        for (const component of Object.values(currentState.formComponents)) {
            component.hidden = hidden.includes(component.propertyName);
        }

        return Promise.resolve();
    }

    protected async validateForm(
        formTarget: IPublishForm,
        propertyName?: keyof IPublishForm,
        updateValidation?: boolean,
    ): Promise<(keyof IPublishForm)[]> {
        // Call parent validation logic which returns array of fields with errors
        const erroredInputs = await super.validateForm(formTarget, propertyName, updateValidation);

        // erroredInputs only contains fields validated with updateValidation=true (on blur)
        // So we also need to check for missing required values (which may not be validated yet on dialog open)
        const hasValidationErrors = updateValidation && erroredInputs.length > 0;
        const hasMissingRequiredValues = hasAnyMissingRequiredValues(
            this.state.formComponents,
            this.state.formState,
        );

        // hasFormErrors state tracks to disable buttons if ANY errors exist
        this.state.hasFormErrors = hasValidationErrors || hasMissingRequiredValues;

        return erroredInputs;
    }
}
