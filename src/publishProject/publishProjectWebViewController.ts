/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import * as constants from "../constants/constants";
import { FormWebviewController } from "../forms/formWebviewController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { PublishProject as Loc } from "../constants/locConstants";
import {
    PublishDialogReducers,
    PublishDialogFormItemSpec,
    IPublishForm,
    PublishDialogState,
} from "../sharedInterfaces/publishDialog";
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

    constructor(
        context: vscode.ExtensionContext,
        _vscodeWrapper: VscodeWrapper,
        projectFilePath: string,
        sqlProjectsService?: SqlProjectsService,
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
                    this.state.projectProperties = {
                        ...props,
                    } as {
                        [key: string]: unknown;
                        targetVersion?: string;
                    };
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
            // Open file browser to select a .publish.xml file
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
                    [Loc.PublishProfileFiles]: ["publish.xml"],
                },
            });

            if (fileUris && fileUris.length > 0) {
                const selectedPath = fileUris[0].fsPath;
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
                // TODO: implement profile saving logic using _payload.publishProfileName
                // This should save current form state to a file with the given name
                return state;
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

        if (state.formState.publishTarget === constants.PublishTargets.LOCAL_CONTAINER) {
            activeComponents.push(...constants.PublishFormContainerFields);
        }

        return activeComponents;
    }

    public updateItemVisibility(state?: PublishDialogState): Promise<void> {
        const currentState = state || this.state;
        const target = currentState.formState?.publishTarget;
        const hidden: string[] = [];

        if (target === constants.PublishTargets.LOCAL_CONTAINER) {
            // Container deployment: hide server name field
            hidden.push(constants.PublishFormFields.ServerName);
        } else if (
            target === constants.PublishTargets.EXISTING_SERVER ||
            target === constants.PublishTargets.NEW_AZURE_SERVER
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
