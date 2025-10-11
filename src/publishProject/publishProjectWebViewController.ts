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
    PublishDialogState,
    PublishTarget,
} from "../sharedInterfaces/publishDialog";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent } from "../telemetry/telemetry";
import { generatePublishFormComponents } from "./formComponentHelpers";
import { loadDockerTags } from "./dockerUtils";
import { readProjectProperties, parsePublishProfileXml } from "./projectUtils";
import { SqlProjectsService } from "../services/sqlProjectsService";
import { Deferred } from "../protocol";

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
        sqlProjectsService: SqlProjectsService,
        dacFxService: mssql.IDacFxService,
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
                    publishTarget: "existingServer",
                    sqlCmdVariables: {},
                },
                formComponents: {},
                projectFilePath,
                inProgress: false,
                lastPublishResult: undefined,
                deploymentOptions: deploymentOptions,
                waitingForNewConnection: false,
                activeServers: {},
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

        // Listen for new connections (similar to schema compare)
        this.registerDisposable(
            this._connectionManager.onConnectionsChanged(async () => {
                // Check if we're waiting for a new connection
                if (this.state.waitingForNewConnection) {
                    const activeServers = this.getActiveServersList();
                    const newConnections = this.findNewConnections(
                        this.state.activeServers,
                        activeServers,
                    );

                    if (newConnections.length > 0) {
                        // Update active servers first
                        this.state.activeServers = activeServers;

                        // Auto-select the first new connection
                        const newConnectionUri = newConnections[0];
                        await this.autoSelectNewConnection(newConnectionUri);
                    }
                } else {
                    // Update active servers even if not waiting
                    this.state.activeServers = this.getActiveServersList();
                }

                this.updateState();
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
        } catch {
            // swallow errors; keep dialog resilient
        }

        // Load publish form components
        this.state.formComponents = generatePublishFormComponents(
            projectTargetVersion,
            this.state.formState.databaseName,
        );

        // Update state to notify UI of the project properties and form components
        this.updateState();

        // Fetch Docker tags for the container image dropdown
        if (projectTargetVersion) {
            const tagComponent =
                this.state.formComponents[constants.PublishFormFields.ContainerImageTag];
            if (tagComponent) {
                await loadDockerTags(projectTargetVersion, tagComponent, this.state.formState);
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

        this.registerReducer("generatePublishScript", async (state: PublishDialogState) => {
            // TODO: implement script generation logic
            return state;
        });

        this.registerReducer("selectPublishProfile", async (state: PublishDialogState) => {
            const projectFolderPath = state.projectProperties?.projectFolderPath;

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
                const projectFolderPath = state.projectProperties?.projectFolderPath;
                const projectName = state.projectProperties?.projectName;

                // Use selected profile path if available, otherwise save as projectName
                const defaultPath = state.formState.publishProfilePath
                    ? vscode.Uri.file(state.formState.publishProfilePath)
                    : vscode.Uri.file(
                          path.join(
                              projectFolderPath || ".",
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
                try {
                    const databaseName = state.formState.databaseName || projectName;
                    const connectionString = state.connectionString || "";
                    const sqlCmdVariables = new Map(
                        Object.entries(state.formState.sqlCmdVariables || {}),
                    );

                    await this._dacFxService!.savePublishProfile(
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

    /** Get the list of active server connections */
    private getActiveServersList(): {
        [connectionUri: string]: { profileName: string; server: string };
    } {
        const activeServers: { [connectionUri: string]: { profileName: string; server: string } } =
            {};
        const activeConnections = this._connectionManager.activeConnections;
        Object.keys(activeConnections).forEach((connectionUri) => {
            const credentials = activeConnections[connectionUri].credentials as IConnectionProfile;
            activeServers[connectionUri] = {
                profileName: credentials.profileName ?? "",
                server: credentials.server,
            };
        });
        return activeServers;
    }

    /** Find new connections that were added */
    private findNewConnections(
        oldActiveServers: { [connectionUri: string]: { profileName: string; server: string } },
        newActiveServers: { [connectionUri: string]: { profileName: string; server: string } },
    ): string[] {
        const newConnections: string[] = [];
        for (const connectionUri in newActiveServers) {
            if (!(connectionUri in oldActiveServers)) {
                newConnections.push(connectionUri);
            }
        }
        return newConnections;
    }

    /** Auto-select a new connection and populate server/database fields */
    private async autoSelectNewConnection(connectionUri: string): Promise<void> {
        try {
            // Get the list of databases for the new connection
            const databases = await this._connectionManager.listDatabases(connectionUri);

            // Get the connection profile
            const connection = this._connectionManager.activeConnections[connectionUri];
            const connectionProfile = connection?.credentials as IConnectionProfile;

            if (connectionProfile) {
                // Update server name
                this.state.formState.serverName = connectionProfile.server;

                // Get connection string (include password for publishing)
                const connectionString = await this._connectionManager.getConnectionString(
                    connectionUri,
                    true, // includePassword
                    true, // includeApplicationName
                );
                this.state.connectionString = connectionString;

                // Update database dropdown options
                const databaseComponent =
                    this.state.formComponents[constants.PublishFormFields.DatabaseName];
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
            }
        } catch {
            // Silently fail - connection issues are handled elsewhere
        } finally {
            // Reset the waiting state
            this.state.waitingForNewConnection = false;
        }
    }

    protected getActiveFormComponents(state: PublishDialogState): (keyof IPublishForm)[] {
        const activeComponents: (keyof IPublishForm)[] = [
            constants.PublishFormFields.PublishTarget,
            constants.PublishFormFields.PublishProfilePath,
            constants.PublishFormFields.ServerName,
            constants.PublishFormFields.DatabaseName,
        ] as (keyof IPublishForm)[];

        if (state.formState.publishTarget === PublishTarget.LocalContainer) {
            activeComponents.push(...constants.PublishFormContainerFields);
        }

        return activeComponents;
    }

    public updateItemVisibility(state?: PublishDialogState): Promise<void> {
        const currentState = state || this.state;
        const target = currentState.formState?.publishTarget;
        const hidden: string[] = [];

        if (target === PublishTarget.LocalContainer) {
            // Container deployment: hide server name field
            hidden.push(constants.PublishFormFields.ServerName);
        } else if (
            target === PublishTarget.ExistingServer ||
            target === PublishTarget.NewAzureServer
        ) {
            // Existing server or new Azure server: hide container-specific fields
            hidden.push(...constants.PublishFormContainerFields);
        }

        for (const component of Object.values(currentState.formComponents)) {
            component.hidden = hidden.includes(component.propertyName);
        }

        return Promise.resolve();
    }
}
