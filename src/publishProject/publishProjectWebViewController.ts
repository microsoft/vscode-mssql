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
        const initialFormState: IPublishForm = {
            profileName: "",
            serverName: "",
            databaseName: path.basename(projectFilePath, path.extname(projectFilePath)),
            publishTarget: constants.PublishTargets.EXISTING_SERVER,
            sqlCmdVariables: {},
        };

        const innerState: PublishDialogState = {
            formState: initialFormState,
            formComponents: {},
            projectFilePath,
            inProgress: false,
            lastPublishResult: undefined,
        } as PublishDialogState;

        const initialState: PublishDialogState = innerState;

        super(context, _vscodeWrapper, "publishDialog", "publishDialog", initialState, {
            title: Loc.Title,
            viewColumn: vscode.ViewColumn.Active,
            iconPath: {
                dark: vscode.Uri.joinPath(context.extensionUri, "media", "schemaCompare_dark.svg"),
                light: vscode.Uri.joinPath(
                    context.extensionUri,
                    "media",
                    "schemaCompare_light.svg",
                ),
            },
        });

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
        // Load publish form components asynchronously for future extensibility
        this.state.formComponents = await generatePublishFormComponents();

        // keep initial project path and computed database name
        if (projectFilePath) {
            this.state.projectFilePath = projectFilePath;
        }

        // Attempt to load project properties (non-blocking). This enriches state with targetVersion
        // and other metadata used for default selections (e.g., docker image tags)
        try {
            if (this._sqlProjectsService && projectFilePath) {
                const props = await readProjectProperties(
                    this._sqlProjectsService,
                    projectFilePath,
                );
                if (props) {
                    // Copy into loose index-signature shape expected by state
                    this.state.projectProperties = {
                        ...props,
                    } as {
                        [key: string]: unknown;
                        targetVersion?: string;
                    };
                    // Update state to notify UI of the new project properties
                    this.updateState();

                    // Fetch Docker tags for the container image dropdown
                    if (props.targetVersion) {
                        const tagComponent =
                            this.state.formComponents[
                                constants.PublishFormFields.ContainerImageTag
                            ];
                        if (tagComponent) {
                            await loadDockerTags(
                                props.targetVersion,
                                tagComponent,
                                this.state.formState,
                            );
                        }
                    }
                }
            }
        } catch {
            // swallow errors; keep dialog resilient
        }

        await this.updateItemVisibility();
        this.updateState();
    }

    /** Registers all reducers in pure (immutable) style */
    private registerRpcHandlers() {
        // setPublishValues
        this.registerReducer("setPublishValues", async (state, payload) => {
            const changes = payload || {};
            const newFormState = { ...state.formState, ...changes };
            const newState: PublishDialogState = {
                ...state,
                formState: newFormState,
                projectFilePath: changes.projectFilePath ?? state.projectFilePath,
            };
            await this.updateItemVisibility(newState);
            return newState;
        });

        this.registerReducer("publishNow", async (state) => {
            // TODO: implement actual publish logic (currently just clears inProgress)
            return { ...state, inProgress: false };
        });

        this.registerReducer("generatePublishScript", async (state) => {
            // TODO: implement script generation logic
            return { ...state };
        });

        this.registerReducer("selectPublishProfile", async (state) => {
            // TODO: implement profile selection logic
            return { ...state };
        });

        this.registerReducer("savePublishProfile", async (state, payload) => {
            // TODO: implement profile saving logic
            if (payload?.profileName) {
                return {
                    ...state,
                    formState: { ...state.formState, profileName: payload.profileName },
                };
            }
            return state;
        });

        this.registerReducer("openPublishAdvanced", async (state) => {
            // TODO: implement advanced publish options
            return { ...state };
        });
    }

    protected getActiveFormComponents(state: PublishDialogState): (keyof IPublishForm)[] {
        const activeComponents: (keyof IPublishForm)[] = [
            constants.PublishFormFields.PublishTarget,
            constants.PublishFormFields.ProfileName,
            constants.PublishFormFields.ServerName,
            constants.PublishFormFields.DatabaseName,
        ] as (keyof IPublishForm)[];

        if (state.formState.publishTarget === constants.PublishTargets.LOCAL_CONTAINER) {
            activeComponents.push(
                constants.PublishFormFields.ContainerPort,
                constants.PublishFormFields.ContainerAdminPassword,
                constants.PublishFormFields.ContainerAdminPasswordConfirm,
                constants.PublishFormFields.ContainerImageTag,
                constants.PublishFormFields.AcceptContainerLicense,
            );
        }

        return activeComponents;
    }

    public async updateItemVisibility(state?: PublishDialogState): Promise<void> {
        const currentState = state || this.state;
        const target = currentState.formState?.publishTarget;
        const hidden: string[] = [];

        if (target === constants.PublishTargets.LOCAL_CONTAINER) {
            // Hide server-specific fields when targeting local container
            hidden.push(constants.PublishFormFields.ServerName);
        } else if (target === constants.PublishTargets.EXISTING_SERVER) {
            // Hide container-specific fields when targeting existing server
            hidden.push(
                constants.PublishFormFields.ContainerPort,
                constants.PublishFormFields.ContainerAdminPassword,
                constants.PublishFormFields.ContainerAdminPasswordConfirm,
                constants.PublishFormFields.ContainerImageTag,
                constants.PublishFormFields.AcceptContainerLicense,
            );
        }

        for (const component of Object.values(currentState.formComponents)) {
            component.hidden = hidden.includes(component.propertyName);
        }
    }
}
