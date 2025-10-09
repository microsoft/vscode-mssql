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
import { readProjectProperties } from "./projectUtils";
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

    constructor(
        context: vscode.ExtensionContext,
        _vscodeWrapper: VscodeWrapper,
        projectFilePath: string,
        deploymentOptions?: mssql.DeploymentOptions,
        sqlProjectsService?: SqlProjectsService,
        dacFxService?: mssql.IDacFxService,
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

        // Store the SQL Projects Service
        this._sqlProjectsService = sqlProjectsService;
        this._dacFxService = dacFxService;

        // Register reducers after initialization
        this.registerRpcHandlers();

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
        this.state.formComponents = generatePublishFormComponents(projectTargetVersion);

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
                    [Loc.PublishProfileFiles]: [constants.PublishProfileExtension],
                },
            });

            if (fileUris && fileUris.length > 0) {
                const selectedPath = fileUris[0].fsPath;

                // Send telemetry for profile loaded
                sendActionEvent(TelemetryViews.SqlProjects, TelemetryActions.profileLoaded);

                // Update the publishProfilePath in form state
                return {
                    ...state,
                    formState: {
                        ...state.formState,
                        publishProfilePath: selectedPath,
                    },
                };
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
                        [Loc.PublishProfileFiles]: [constants.PublishProfileExtension],
                    },
                });

                if (!fileUri) {
                    return state; // User cancelled
                }

                // Call DacFx service to save the profile
                if (this._dacFxService) {
                    try {
                        const databaseName = state.formState.databaseName || projectName;
                        // TODO: Build connection string from state.formState.serverName and connection details
                        const connectionString = "";
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
                        sendActionEvent(TelemetryViews.SqlProjects, TelemetryActions.profileSaved);

                        void vscode.window.showInformationMessage(
                            `Publish profile saved to: ${fileUri.fsPath}`,
                        );
                    } catch (error) {
                        void vscode.window.showErrorMessage(
                            `Failed to save publish profile: ${error}`,
                        );
                    }

                    return state;
                }

                // If DacFx service is not available, just update the path
                void vscode.window.showWarningMessage(
                    "DacFx service not available. Profile path updated but not saved.",
                );
                return {
                    ...state,
                    formState: {
                        ...state.formState,
                        publishProfilePath: fileUri.fsPath,
                    },
                };
            },
        );
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
