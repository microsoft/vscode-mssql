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
import ConnectionManager from "../controllers/connectionManager";
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

export class PublishProjectWebViewController extends FormWebviewController<
    IPublishForm,
    PublishDialogState,
    PublishDialogFormItemSpec,
    PublishDialogReducers
> {
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
                deploymentOptions: deploymentOptions,
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

        // Store the SQL Projects Service and Connection Manager
        this._sqlProjectsService = sqlProjectsService;
        this._dacFxService = dacFxService;
        this._connectionManager = connectionManager;

        // Clear default excludeObjectTypes for publish dialog, no default exclude options should exist
        if (
            this.state.deploymentOptions &&
            this.state.deploymentOptions.excludeObjectTypes !== undefined
        ) {
            this.state.deploymentOptions.excludeObjectTypes.value = [];
        }

        // Register reducers after initialization
        this.registerRpcHandlers();

        // Listen for successful connections
        this.registerDisposable(
            this._connectionManager.onSuccessfulConnection(async (event) => {
                // Only auto-populate if waiting for a new connection
                if (this.state.waitingForNewConnection) {
                    // Auto-populate from the new connection (this will call updateState internally)
                    await this.autoSelectNewConnection(event.fileUri);
                }
            }),
        );

        // Initialize async to allow for future extensibility and proper error handling
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
        // keep initial project path and computed database name
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
                false, // don't include error message in telemetry for privacy
            );
        }

        // Load publish form components
        this.state.formComponents = generatePublishFormComponents(
            projectTargetVersion,
            this.state.formState.databaseName,
        );

        // Update state to notify UI of the project properties and form components
        this.updateState();

        // Fetch Docker tags for the container image dropdown
        // Use the deployment UI function with target version filtering
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
                // Keep dialog resilient - don't block if Docker tags fail to load
            }
        }

        void this.updateItemVisibility();
    }

    /** Registers all reducers in pure (immutable) style */
    private registerRpcHandlers(): void {
        this.registerReducer("openConnectionDialog", async (state: PublishDialogState) => {
            // Set waiting state to detect new connections
            state.waitingForNewConnection = true;
            this.updateState(state);

            // Execute the command to open the connection dialog (same as "+" button in servers panel)
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

            if (fileUris && fileUris.length > 0) {
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
                    return {
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
                    };
                } catch (error) {
                    void vscode.window.showErrorMessage(
                        `${Loc.PublishProfileLoadFailed}: ${error}`,
                    );
                }
            }

            return state;
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
                    void vscode.window.showErrorMessage(Loc.DacFxServiceNotAvailable);
                    return state;
                }

                try {
                    const databaseName = state.formState.databaseName || projectName;
                    // Connection string depends on publish target:
                    // - For container targets: empty string (no server connection)
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

                    // Send telemetry for profile saved
                    sendActionEvent(
                        TelemetryViews.SqlProjects,
                        TelemetryActions.PublishProfileSaved,
                    );

                    void vscode.window.showInformationMessage(
                        Loc.PublishProfileSavedSuccessfully(fileUri.fsPath),
                    );
                } catch (error) {
                    void vscode.window.showErrorMessage(
                        `${Loc.PublishProfileSaveFailed}: ${error}`,
                    );
                }

                return state;
            },
        );
    }

    /** Auto-select a new connection and populate server/database fields */
    private async autoSelectNewConnection(connectionUri: string): Promise<void> {
        try {
            // IMPORTANT: Get the connection profile FIRST, before any async calls
            // The connection URI may be removed from activeConnections during async operations
            const connection = this._connectionManager.activeConnections[connectionUri];
            if (!connection || !connection.credentials) {
                return; // Connection not found or no credentials available
            }

            const connectionProfile = connection.credentials as IConnectionProfile;
            if (!connectionProfile || !connectionProfile.server) {
                return; // Connection profile invalid or no server specified
            }

            // Update server name immediately
            this.state.formState.serverName = connectionProfile.server;

            // Get connection string first
            const connectionString = await this._connectionManager.getConnectionString(
                connectionUri,
                true, // includePassword
                true, // includeApplicationName
            );
            this.state.connectionString = connectionString;

            // Get databases
            const databases = await this._connectionManager.listDatabases(connectionUri);

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

            // Update UI immediately to reflect the new connection
            this.updateState();
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
     * Override to handle publish target changes and manage database dropdown options
     */
    public async afterSetFormProperty(propertyName: keyof IPublishForm): Promise<void> {
        if (propertyName === PublishFormFields.PublishTarget) {
            const databaseComponent = this.state.formComponents[PublishFormFields.DatabaseName];

            if (!databaseComponent) {
                return;
            }

            // When switching TO LOCAL_CONTAINER
            if (this.state.formState.publishTarget === PublishTarget.LocalContainer) {
                // Store current database list and selected value to restore later
                if (databaseComponent.options && databaseComponent.options.length > 0) {
                    this.state.previousDatabaseList = [...databaseComponent.options];
                    this.state.previousSelectedDatabase = this.state.formState.databaseName;
                }
                // Clear database dropdown options for container (freeform only)
                databaseComponent.options = [];

                // Reset to project name for container mode
                this.state.formState.databaseName = path.basename(
                    this.state.projectFilePath,
                    path.extname(this.state.projectFilePath),
                );

                // Clear connection string when switching to container target
                this.state.connectionString = undefined;
            }
            // When switching TO EXISTING_SERVER
            else if (this.state.formState.publishTarget === PublishTarget.ExistingServer) {
                // Restore previous database list if it was stored (preserve the list from when user connected)
                if (this.state.previousDatabaseList && this.state.previousDatabaseList.length > 0) {
                    databaseComponent.options = [...this.state.previousDatabaseList];

                    // Restore previously selected database
                    if (this.state.previousSelectedDatabase) {
                        this.state.formState.databaseName = this.state.previousSelectedDatabase;
                    }
                }
            }

            this.updateState();
        }

        return Promise.resolve();
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
        // Call parent validation logic
        const erroredInputs = await super.validateForm(formTarget, propertyName, updateValidation);

        // Update validation state properties
        if (updateValidation) {
            this.updateFormValidationState();
        }

        return erroredInputs;
    }

    private updateFormValidationState(): void {
        // Check if any visible component has validation errors
        this.state.hasValidationErrors = Object.values(this.state.formComponents).some(
            (component) =>
                !component.hidden &&
                component.validation !== undefined &&
                component.validation.isValid === false,
        );

        // Check if any required fields are missing values
        this.state.hasMissingRequiredValues = Object.values(this.state.formComponents).some(
            (component) => {
                if (component.hidden || !component.required) {
                    return false;
                }
                const key = component.propertyName as keyof IPublishForm;
                const raw = this.state.formState[key];
                // Missing if undefined/null
                if (raw === undefined) {
                    return true;
                }
                // For strings, empty/whitespace is missing
                if (typeof raw === "string") {
                    return raw.trim().length === 0;
                }
                // For booleans (e.g. required checkbox), must be true
                if (typeof raw === "boolean") {
                    return raw !== true;
                }
                // For numbers, allow 0 (not missing)
                return false;
            },
        );
    }
}
