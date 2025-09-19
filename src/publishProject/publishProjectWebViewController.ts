/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { FormWebviewController } from "../forms/formWebviewController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { PublishProject as Loc } from "../constants/locConstants";
import {
    PublishDialogWebviewState,
    PublishDialogFormItemSpec,
    IPublishForm,
    PublishDialogReducers,
} from "../sharedInterfaces/publishDialog";
import { generatePublishFormComponents } from "./formComponentHelpers";
import { getProjectTargetVersion, readProjectProperties } from "./ProjectUtils";
import { SqlProjectsService } from "../services/sqlProjectsService";
import { filterAndSortTags, getDockerBaseImage } from "./dockerUtils";

export class PublishProjectWebViewController extends FormWebviewController<
    IPublishForm,
    PublishDialogWebviewState,
    PublishDialogFormItemSpec,
    PublishDialogReducers
> {
    public static mainOptions: readonly (keyof IPublishForm)[] = [
        "publishTarget",
        "profileName",
        "serverName",
        "databaseName",
    ];

    constructor(
        context: vscode.ExtensionContext,
        _vscodeWrapper: VscodeWrapper,
        projectFilePath: string,
        private readonly sqlProjectsService: SqlProjectsService,
    ) {
        const initialFormState: IPublishForm = {
            profileName: "",
            serverName: "",
            databaseName: getFileNameWithoutExt(projectFilePath),
            publishTarget: "existingServer",
            sqlCmdVariables: {},
        };

        const initialState: PublishDialogWebviewState = {
            formState: initialFormState,
            formComponents: {},
            projectFilePath,
            inProgress: false,
            lastPublishResult: undefined,
        } as PublishDialogWebviewState;

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

        this.registerRpcHandlers();

        // Initialize so component generation can be async
        void this.initializeDialog(projectFilePath);
    }

    private async initializeDialog(projectFilePath: string) {
        // Load publish form components
        this.state.formComponents = await generatePublishFormComponents();

        // keep initial project path and computed database name
        if (projectFilePath) {
            this.state.projectFilePath = projectFilePath;
        }

        // Preload project properties (non-blocking for UI; await to ensure availability for first requests)
        try {
            const props = await readProjectProperties(
                this.sqlProjectsService,
                this.state.projectFilePath,
            );
            if (props) {
                (this.state as any).projectProperties = props; // eslint-disable-line @typescript-eslint/no-explicit-any
                // Also attach transient version so initial webview renderers that ask for it have it
                (this.state as any).__projectTargetVersion = props.targetVersion; // eslint-disable-line @typescript-eslint/no-explicit-any
            }
        } catch {
            // Swallow errors; dialog should still load
        }

        await this.updateItemVisibility();
        this.updateState();
    }

    /**
     * Explicitly registers all reducers
     */
    private registerRpcHandlers(): void {
        // setPublishValues
        this.registerReducer(
            "setPublishValues",
            async (
                state: PublishDialogWebviewState,
                payload: Partial<IPublishForm> & { projectFilePath?: string },
            ) => {
                if (payload) {
                    state.formState = { ...state.formState, ...payload };
                    if (payload.projectFilePath) {
                        state.projectFilePath = payload.projectFilePath;
                    }
                }
                // Re-evaluate visibility if publishTarget or other controlling fields changed
                await this.updateItemVisibility();
                this.updateState(state);
                return state;
            },
        );

        this.registerReducer("publishNow", async (state: PublishDialogWebviewState) => {
            // TODO: implement actual publish logic (currently just clears inProgress)
            state.inProgress = false;
            this.updateState(state);
            return state;
        });

        this.registerReducer("generatePublishScript", async (state: PublishDialogWebviewState) => {
            // Placeholder: generation logic would go here
            this.updateState(state);
            return state;
        });

        this.registerReducer("selectPublishProfile", async (state: PublishDialogWebviewState) => {
            // Actual selection logic lives in front-end -> triggers profile read elsewhere
            this.updateState(state);
            return state;
        });

        this.registerReducer(
            "savePublishProfile",
            async (state: PublishDialogWebviewState, payload: { profileName?: string }) => {
                if (payload?.profileName) {
                    state.formState.profileName = payload.profileName;
                }
                this.updateState(state);
                return state;
            },
        );

        this.registerReducer("fetchTargetDetails", async (state: PublishDialogWebviewState) => {
            // Legacy no-op retained
            return state;
        });

        this.registerReducer("getProjectProperties", async (state: PublishDialogWebviewState) => {
            // If we've already loaded properties, just attach transient version again
            if (!state.projectProperties) {
                const props = await readProjectProperties(
                    this.sqlProjectsService,
                    state.projectFilePath,
                );
                if (props) {
                    state.projectProperties = props;
                }
            }
            const version =
                state.projectProperties?.targetVersion ??
                (await getProjectTargetVersion(this.sqlProjectsService, state.projectFilePath));
            // Store transient helper without polluting strong type (augment state via index signature pattern)
            (state as unknown as { __projectTargetVersion?: string }).__projectTargetVersion =
                version;
            return state;
        });

        // Fetch docker tags server-side to avoid CORS issues in webview
        this.registerReducer(
            "fetchDockerTags",
            async (
                state: PublishDialogWebviewState,
                payload: { tagsUrl: string },
            ): Promise<PublishDialogWebviewState> => {
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
                        // ignore network errors; we'll leave options empty
                    }
                }

                // Derive docker base image info (needs target version; fall back to empty string if undefined)
                const targetVersion = state.projectProperties?.targetVersion || "";
                const baseImage = getDockerBaseImage(targetVersion, undefined);
                const imageTags = filterAndSortTags(tags, baseImage, targetVersion, true);

                // Update the form component directly
                const tagComponent = Object.values(state.formComponents).find(
                    (c) => c.propertyName === "containerImageTag",
                );
                if (tagComponent) {
                    tagComponent.options = imageTags.map((t) => ({ value: t, displayName: t }));
                }

                this.updateState(state);
                return state;
            },
        );

        // Optional: openPublishAdvanced placeholder (declared in interface but not implemented earlier)
        this.registerReducer("openPublishAdvanced", async (state: PublishDialogWebviewState) => {
            // Could open a secondary panel / advanced options; no-op for now
            return state;
        });
    }

    protected getActiveFormComponents(_state: PublishDialogWebviewState) {
        return [...PublishProjectWebViewController.mainOptions];
    }

    public async updateItemVisibility(): Promise<void> {
        const hidden: (keyof IPublishForm)[] = [];

        // Example visibility: local container target doesn't require a server name
        if (this.state.formState?.publishTarget === "localContainer") {
            hidden.push("serverName");
        }

        for (const component of Object.values(this.state.formComponents)) {
            // mark hidden if the property is in hidden list
            component.hidden = hidden.includes(component.propertyName as keyof IPublishForm);
        }
        // Ensure main options exist (fallback in case generation failed earlier)
        for (const key of PublishProjectWebViewController.mainOptions) {
            if (!this.state.formComponents[key]) {
                // regenerate missing component set lazily
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                generatePublishFormComponents().then((c) => {
                    this.state.formComponents = c;
                    this.updateState();
                });
                break;
            }
        }
    }
}

function getFileNameWithoutExt(filePath: string): string {
    if (!filePath) {
        return "";
    }
    const parts = filePath.replace(/\\/g, "/").split("/");
    const last = parts[parts.length - 1];
    return last.replace(/\.[^/.]+$/, "");
}
