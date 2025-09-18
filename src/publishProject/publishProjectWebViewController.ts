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
    PublishDialogReducers,
    PublishDialogFormItemSpec,
    IPublishForm,
} from "../sharedInterfaces/publishDialog";
import { generatePublishFormComponents } from "./formComponentHelpers";
import * as mssql from "vscode-mssql";
import { getSqlProjectsApi } from "../services/sqlProjectsApi";

interface SqlProjectsPublishProfile {
    databaseName?: string;
    serverName?: string;
    sqlCmdVariables?: Map<string, string>;
    options?: mssql.DeploymentOptions;
}

export class PublishProjectWebViewController extends FormWebviewController<
    IPublishForm,
    PublishDialogWebviewState,
    PublishDialogFormItemSpec,
    PublishDialogReducers
> {
    public static mainOptions: readonly (keyof IPublishForm)[] = [
        "publishTarget",
        "profilePath",
        "serverName",
        "databaseName",
    ];

    constructor(
        context: vscode.ExtensionContext,
        _vscodeWrapper: VscodeWrapper,
        projectFilePath: string,
    ) {
        const initialFormState: IPublishForm = {
            profilePath: "",
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

        this.registerPublishReducers();

        // Initialize so component generation can be async
        void this.initializeDialog(projectFilePath);
    }

    private registerPublishReducers() {
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
                this.updateState(state);
                return state;
            },
        );

        // publishNow (placeholder for actual publish implementation)
        this.registerReducer("publishNow", async (state: PublishDialogWebviewState) => {
            state.inProgress = false;
            this.updateState(state);
            return state;
        });

        // generatePublishScript stub
        this.registerReducer("generatePublishScript", async (state: PublishDialogWebviewState) => {
            this.updateState(state);
            return state;
        });

        // selectPublishProfile -> open dialog and capture path (prefer sql-database-projects API)
        this.registerReducer("selectPublishProfile", async (state: PublishDialogWebviewState) => {
            try {
                const filters: Record<string, string[]> = { "Publish Profiles": ["publish.xml"] };
                const uris = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectMany: false,
                    canSelectFolders: false,
                    openLabel: "Select",
                    filters,
                });
                if (!uris || uris.length === 0) {
                    this.updateState(state);
                    return state;
                }
                const fileUri = uris[0];
                const normalizedFullPath = fileUri.fsPath.replace(/\\/g, "/");
                state.formState.profilePath = normalizedFullPath;
                state.publishFileName = normalizedFullPath.split("/").pop() || normalizedFullPath;

                try {
                    const api = await getSqlProjectsApi();
                    if (api) {
                        const prof = (await api.readPublishProfile(
                            fileUri,
                        )) as SqlProjectsPublishProfile;
                        if (prof.databaseName) {
                            state.formState.databaseName = prof.databaseName;
                        }
                        if (prof.serverName) {
                            state.formState.serverName = prof.serverName;
                        }
                        if (prof.sqlCmdVariables && prof.sqlCmdVariables.size) {
                            const varsObj: { [k: string]: string } = {};
                            (prof.sqlCmdVariables as Map<string, string>).forEach(
                                (v: string, k: string) => (varsObj[k] = v),
                            );
                            state.formState.sqlCmdVariables = varsObj;
                        }
                        if (prof.options) {
                            state.formState.deploymentOptions =
                                prof.options as mssql.DeploymentOptions;
                        }
                    } else {
                        void vscode.window.showWarningMessage(
                            "SQL Projects API unavailable for reading publish profile.",
                        );
                    }
                } catch {
                    // ignore API issues
                }
            } catch {
                // ignore cancellation/errors
            }
            this.updateState(state);
            return state;
        });

        // savePublishProfile -> open Save dialog defaulting to current profile directory + provided/new filename
        this.registerReducer("savePublishProfile", async (state: PublishDialogWebviewState) => {
            // projectFilePath is always defined for this dialog; derive folder + name from it
            const normProj = state.projectFilePath.replace(/\\/g, "/");
            const lastSlash = normProj.lastIndexOf("/");
            const directory = lastSlash >= 0 ? normProj.substring(0, lastSlash) : normProj;
            const projectBaseName = getFileNameWithoutExt(state.projectFilePath);
            const base = `${projectBaseName}.publish.xml`;
            const defaultUri = vscode.Uri.file(`${directory}/${base}`);

            const saveUri = await vscode.window.showSaveDialog({
                defaultUri,
                filters: { "Publish Profile": ["publish.xml"] },
                saveLabel: "Save Publish Profile",
            });
            if (saveUri) {
                const full = saveUri.fsPath.replace(/\\/g, "/");
                state.formState.profilePath = full;
                state.publishFileName = base; // keep for potential reuse

                // Prepare data for dacFx savePublishProfile
                const databaseName = state.formState.databaseName;
                // Connection string not yet gathered in this dialog variant; using empty string placeholder
                const connectionString = ""; // TODO: capture connection selection when implemented
                // Convert sqlCmdVariables object to Map<string,string>
                let sqlCmdMap: Map<string, string> | undefined;
                if (state.formState.sqlCmdVariables) {
                    sqlCmdMap = new Map(
                        Object.entries(state.formState.sqlCmdVariables).map(([k, v]) => [
                            k,
                            v ?? "",
                        ]),
                    );
                }
                const deploymentOptions = state.formState.deploymentOptions as
                    | mssql.DeploymentOptions
                    | undefined;
                try {
                    const api = await getSqlProjectsApi();
                    if (!api) {
                        void vscode.window.showWarningMessage(
                            "SQL Projects API unavailable. Cannot save publish profile.",
                        );
                    } else {
                        await api.savePublishProfile(
                            full,
                            databaseName,
                            connectionString,
                            sqlCmdMap,
                            deploymentOptions,
                        );
                        void vscode.window.showInformationMessage(`Publish profile saved: ${full}`);
                    }
                } catch (err) {
                    void vscode.window.showErrorMessage(
                        `Failed to save publish profile: ${(err as Error).message}`,
                    );
                }
            }
            this.updateState(state);
            return state;
        });
    }

    private async initializeDialog(projectFilePath: string) {
        // Load publish form components
        this.state.formComponents = await generatePublishFormComponents();

        // keep initial project path and computed database name
        if (projectFilePath) {
            this.state.projectFilePath = projectFilePath;
        }

        await this.updateItemVisibility();
        this.updateState();
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

        return;
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
