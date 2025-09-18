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
import { DacFxService } from "../services/dacFxService";
import * as mssql from "vscode-mssql";

export class PublishProjectWebViewController extends FormWebviewController<
    IPublishForm,
    PublishDialogWebviewState,
    PublishDialogFormItemSpec,
    PublishDialogReducers
> {
    private static readonly _mssqlExtensionId = "ms-mssql.mssql";
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

        // selectPublishProfile -> open dialog and capture path
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
                // Store full path for display and derive file name for save operations

                // Display full absolute path in textbox (normalize backslashes)
                const normalizedFullPath = fileUri.fsPath.replace(/\\/g, "/");
                state.formState.profilePath = normalizedFullPath;
                const baseName = normalizedFullPath.split("/").pop() || normalizedFullPath;
                state.publishFileName = baseName;

                // Retrieve deployment options using DacFx service (activate extension if needed)
                try {
                    const dacfx = await this.getDacFxService();
                    let optionsResult: mssql.DacFxOptionsResult | undefined;
                    if (dacfx) {
                        optionsResult = await dacfx.getOptionsFromProfile(fileUri.fsPath);
                    }

                    // map deployment options
                    if (optionsResult?.deploymentOptions) {
                        // Store for later advanced mapping into advanced options UI
                        state.formState.deploymentOptions =
                            optionsResult.deploymentOptions as mssql.DeploymentOptions;
                    }
                } catch {
                    // ignore if options are empty or read issues
                }

                // Read raw file to extract db/server + sqlcmd vars (connection string not required for this dialog)
                try {
                    const bytes = await vscode.workspace.fs.readFile(fileUri);
                    const text = Buffer.from(bytes).toString("utf8");
                    // Simple regex extraction (TargetDatabaseName last occurrence wins)
                    const dbMatches = [
                        ...text.matchAll(/<TargetDatabaseName>(.*?)<\/TargetDatabaseName>/gi),
                    ];
                    if (dbMatches.length > 0) {
                        state.formState.databaseName = dbMatches[dbMatches.length - 1][1].trim();
                    }
                    // Prefer extracting server from TargetConnectionString's Data Source entry
                    let serverExtracted = false;
                    const connStrMatch =
                        /<TargetConnectionString>([\s\S]*?)<\/TargetConnectionString>/i.exec(text);
                    if (connStrMatch) {
                        const connStr = connStrMatch[1];
                        const dsMatch =
                            /(Data Source|Server|Address|Addr|Network Address)\s*=\s*([^;]+)/i.exec(
                                connStr,
                            );
                        if (dsMatch) {
                            state.formState.serverName = dsMatch[2].trim();
                            serverExtracted = true;
                        }
                    }
                    // Fallback to legacy TargetConnectionServerName element if server not found in connection string
                    if (!serverExtracted) {
                        const serverMatch =
                            /<TargetConnectionServerName>(.*?)<\/TargetConnectionServerName>/i.exec(
                                text,
                            );
                        if (serverMatch) {
                            state.formState.serverName = serverMatch[1].trim();
                        }
                    }
                    // SQLCMD variables
                    const varRegex =
                        /<SQLCMDVariable\s+Include="([^"]+)">([\s\S]*?)<\/SQLCMDVariable>/gi;
                    let vm: RegExpExecArray | null;
                    const mergedVars = { ...(state.formState.sqlCmdVariables ?? {}) };
                    while ((vm = varRegex.exec(text))) {
                        const name = vm[1];
                        const valueMatch = /<Value>([\s\S]*?)<\/Value>/i.exec(vm[2]);
                        if (name && valueMatch) {
                            mergedVars[name] = valueMatch[1].trim();
                        }
                    }
                    if (Object.keys(mergedVars).length) {
                        state.formState.sqlCmdVariables = mergedVars;
                    }
                } catch {
                    // ignore file read issues
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
                    const dacfx = await this.getDacFxService();
                    if (dacfx) {
                        await dacfx.savePublishProfile(
                            full,
                            databaseName,
                            connectionString,
                            sqlCmdMap,
                            deploymentOptions,
                        );
                        void vscode.window.showInformationMessage(`Publish profile saved: ${full}`);
                    } else {
                        void vscode.window.showWarningMessage(
                            "Unable to access DacFx service to save publish profile.",
                        );
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

    /** Acquire the DacFx service from MSSQL extension following the activation pattern used in schema compare */
    private async getDacFxService(): Promise<DacFxService | undefined> {
        try {
            const ext = vscode.extensions.getExtension(
                PublishProjectWebViewController._mssqlExtensionId,
            );
            if (!ext) {
                return undefined;
            }
            if (!ext.isActive) {
                await ext.activate();
            }

            // NOTE: The exported property name is 'dacFx' (capital F) per extension.ts return object
            const api = ext.exports as mssql.IExtension | undefined;
            const svc: DacFxService | undefined = api?.dacFx as DacFxService;
            if (!svc) {
                this.logger?.warn?.("DacFx service not exposed by MSSQL extension exports");
            }
            return svc;
        } catch (err) {
            this.logger?.error?.(
                `Unexpected error while acquiring DacFx service: ${(err as Error).message}`,
            );
            return undefined;
        }
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
