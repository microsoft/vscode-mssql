/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import { FormWebviewController } from "../forms/formWebviewController";
import VscodeWrapper from "../controllers/vscodeWrapper";
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
import { generatePublishFormComponents } from "./formComponentHelpers";
import { readProjectProperties } from "./projectUtils";
import { SqlProjectsService } from "../services/sqlProjectsService";
import { Deferred } from "../protocol";
import { sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";
import { getSqlServerContainerTagsForTargetVersion } from "../publishProject/projectUtils";

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
                    publishTarget: PublishTarget.ExistingServer,
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
                    this.state.projectProperties = props;
                    projectTargetVersion = props.targetVersion;
                }
            }
        } catch (error) {
            // Log error and send telemetry, but keep dialog resilient
            this.logger.error("Failed to read project properties:", error);
            sendErrorEvent(
                TelemetryViews.SqlProjects,
                TelemetryActions.PublishProjectChanges,
                error instanceof Error ? error : new Error(String(error)),
                false, // don't include error message in telemetry for privacy
            );
        }

        // Load publish form components
        this.state.formComponents = generatePublishFormComponents(projectTargetVersion);
        this.updateState();

        // Use deployment UI method to get filtered image tags
        const tagComponent = this.state.formComponents[PublishFormFields.ContainerImageTag];
        if (tagComponent) {
            try {
                const tagOptions =
                    await getSqlServerContainerTagsForTargetVersion(projectTargetVersion);
                tagComponent.options = tagOptions;
                if (!this.state.formState.containerImageTag && tagOptions.length > 0) {
                    this.state.formState.containerImageTag = tagOptions[0].value;
                }
            } catch (error) {
                this.logger.error("Failed to fetch Docker container tags:", error);
            }
        }

        void this.updateItemVisibility();
    }

    /** Registers all reducers in pure (immutable) style */
    private registerRpcHandlers(): void {
        this.registerReducer("publishNow", async (state) => {
            // TODO: implement actual publish logic (currently just clears inProgress)
            state.inProgress = false;
            return state;
        });

        this.registerReducer("generatePublishScript", async (state) => {
            // TODO: implement script generation logic
            return state;
        });

        this.registerReducer("selectPublishProfile", async (state) => {
            // TODO: implement profile selection logic
            return state;
        });

        this.registerReducer("savePublishProfile", async (state, _payload) => {
            // TODO: implement profile saving logic using _payload.publishProfileName
            // This should save current form state to a file with the given name
            return state;
        });
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
