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
    PublishDialogState,
} from "../sharedInterfaces/publishDialog";
import { generatePublishFormComponents } from "./formComponentHelpers";
import { getDockerBaseImage, filterAndSortTags } from "./dockerUtils";
import { readProjectProperties } from "./projectUtils";
import { SqlProjectsService } from "../services/sqlProjectsService";

export class PublishProjectWebViewController extends FormWebviewController<
    IPublishForm,
    PublishDialogState,
    PublishDialogFormItemSpec,
    PublishDialogReducers
> {
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
            publishTarget: "existingServer",
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

        // Initialize so component generation can be async
        void this.initializeDialog(projectFilePath);

        // Register reducers (pure style)
        this.registerReducers();
    }

    private async initializeDialog(projectFilePath: string) {
        // Load publish form components
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
                }
            }
        } catch {
            // swallow errors; keep dialog resilient
        }

        await this.updateItemVisibility();
        this.updateState();
    }
    /** Registers all reducers in pure (immutable) style */
    private registerReducers() {
        // setPublishValues
        this.registerReducer("setPublishValues", async (state, payload) => {
            const changes = payload || {};
            const newFormState = { ...state.formState, ...changes };
            const newState: PublishDialogState = {
                ...state,
                formState: newFormState,
                projectFilePath: changes.projectFilePath ?? state.projectFilePath,
            };
            await this.updateItemVisibility();
            return newState;
        });

        this.registerReducer("publishNow", async (state) => {
            return { ...state, inProgress: false };
        });

        this.registerReducer("generatePublishScript", async (state) => {
            return { ...state }; // placeholder
        });

        this.registerReducer("selectPublishProfile", async (state) => {
            return { ...state }; // placeholder for future selection logic
        });

        this.registerReducer("savePublishProfile", async (state, payload) => {
            if (payload?.profileName) {
                return {
                    ...state,
                    formState: { ...state.formState, profileName: payload.profileName },
                };
            }
            return state;
        });

        this.registerReducer("openPublishAdvanced", async (state) => {
            return { ...state }; // no-op placeholder
        });

        this.registerReducer("fetchDockerTags", async (state, payload) => {
            const url = payload?.tagsUrl;
            let tags: string[] = [];
            if (url) {
                try {
                    const resp = await fetch(url, { method: "GET" });
                    if (resp.ok) {
                        const json = await resp.json();
                        if (json?.tags && Array.isArray(json.tags)) {
                            tags = json.tags as string[];
                        }
                    }
                } catch {
                    // ignore network errors; leave tags empty
                }
            }

            const targetVersion = state.projectProperties?.targetVersion || "";
            const baseImage = getDockerBaseImage(targetVersion, undefined);
            const imageTags = filterAndSortTags(tags, baseImage, targetVersion, true);

            // Update containerImageTag component options if present
            const newFormComponents = { ...state.formComponents };
            const tagComponent = newFormComponents["containerImageTag"] as
                | PublishDialogFormItemSpec
                | undefined;
            if (tagComponent) {
                const updatedTagComponent: PublishDialogFormItemSpec = {
                    ...tagComponent,
                    options: imageTags.map((t) => ({ value: t, displayName: t })),
                };
                newFormComponents["containerImageTag"] = updatedTagComponent;
            }

            let newSelectedTag = state.formState.containerImageTag;
            if (imageTags.length > 0 && (!newSelectedTag || !imageTags.includes(newSelectedTag))) {
                newSelectedTag = imageTags[0];
            }

            return {
                ...state,
                formComponents: newFormComponents,
                formState: { ...state.formState, containerImageTag: newSelectedTag },
            };
        });
    }

    protected getActiveFormComponents(state: PublishDialogState): (keyof IPublishForm)[] {
        const activeComponents: (keyof IPublishForm)[] = [
            "publishTarget",
            "profileName",
            "serverName",
            "databaseName",
        ];

        if (state.formState.publishTarget === "localContainer") {
            activeComponents.push(
                "containerPort",
                "containerAdminPassword",
                "containerAdminPasswordConfirm",
                "containerImageTag",
                "acceptContainerLicense",
            );
        }

        return activeComponents;
    }

    public async updateItemVisibility(): Promise<void> {
        const hidden: (keyof IPublishForm)[] = [];
        if (this.state.formState?.publishTarget === "localContainer") {
            hidden.push("serverName");
        }

        for (const component of Object.values(this.state.formComponents)) {
            component.hidden = hidden.includes(component.propertyName as keyof IPublishForm);
        }
    }
}
