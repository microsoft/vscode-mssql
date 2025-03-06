/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import { SchemaDesigner } from "../sharedInterfaces/schemaDesigner";
import VscodeWrapper from "../controllers/vscodeWrapper";
import * as LocConstants from "../constants/locConstants";

export class SchemaDesignerWebviewController extends ReactWebviewPanelController<
    SchemaDesigner.SchemaDesignerWebviewState,
    SchemaDesigner.SchemaDesignerReducers
> {
    private sessionId: string = "";

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private schemaDesignerService: SchemaDesigner.ISchemaDesignerService,
        private connectionUri: string,
        private databaseName: string,
    ) {
        super(
            context,
            vscodeWrapper,
            "schemaDesigner",
            "schemaDesigner",
            {
                schema: {
                    tables: [],
                },
                isModelReady: false,
                schemas: [],
                datatypes: [],
                script: {
                    combinedScript: "",
                    scripts: [],
                },
            },
            {
                title: databaseName,
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "designSchema_light.svg",
                    ),
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "designSchema_dark.svg",
                    ),
                },
                showRestorePromptAfterClose: false,
            },
        );

        this.registerServiceEvents();
        this.registerReducers();
        void this.createNewSession();
    }

    private registerServiceEvents() {
        let resolveModelReadyProgress: (
            value: void | PromiseLike<void>,
        ) => void;
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: LocConstants.SchemaDesigner.LoadingSchemaDesginerModel,
                cancellable: false,
            },
            (_progress, _token) => {
                const p = new Promise<void>((resolve) => {
                    resolveModelReadyProgress = resolve;
                });
                return p;
            },
        );
        this.schemaDesignerService.onSchemaReady((model) => {
            if (model.sessionId === this.sessionId) {
                resolveModelReadyProgress();
                vscode.window.showInformationMessage(
                    LocConstants.SchemaDesigner.SchemaReady,
                );
                this.updateState({
                    ...this.state,
                    isModelReady: true,
                });
            }
        });
    }

    private registerReducers() {
        this.registerReducer("exportToFile", async (state, payload) => {
            const outputPath = await vscode.window.showSaveDialog({
                filters: {
                    [payload.format]: [payload.format],
                },
                defaultUri: vscode.Uri.file(`newFile.${payload.format}`),
                saveLabel: LocConstants.SchemaDesigner.Save,
                title: LocConstants.SchemaDesigner.SaveAs,
            });
            if (payload.format === "svg") {
                let fileContents = decodeURIComponent(
                    payload.fileContents.split(",")[1],
                );
                await vscode.workspace.fs.writeFile(
                    outputPath,
                    Buffer.from(fileContents, "utf8"),
                );
            } else {
                let fileContents = Buffer.from(
                    payload.fileContents.split(",")[1],
                    "base64",
                );
                vscode.workspace.fs.writeFile(outputPath, fileContents);
            }
            return state;
        });
        this.registerReducer("getScript", async (state, payload) => {
            console.log("getScript", payload);
            const script = await this.schemaDesignerService.generateScript({
                updatedSchema: payload.updatedSchema,
                sessionId: this.sessionId,
            });
            state = {
                ...this.state,
                schema: payload.updatedSchema,
                script: {
                    combinedScript: script.combinedScript,
                    scripts: script.scripts,
                },
            };
            return state;
        });

        this.registerReducer("getReport", async (state, payload) => {
            const report = await this.schemaDesignerService.getReport({
                updatedSchema: payload.updatedSchema,
                sessionId: this.sessionId,
            });
            console.log("getReport", report);
            state = {
                ...this.state,
                schema: payload.updatedSchema,
            };
            return state;
        });
    }

    private async createNewSession() {
        const sessionResponse = await this.schemaDesignerService.createSession({
            connectionUri: this.connectionUri,
            databaseName: this.databaseName,
        });
        this.sessionId = sessionResponse.sessionId;
        this.updateState({
            ...this.state,
            schema: sessionResponse.schema,
            schemas: Array.from(sessionResponse.schemaNames).sort((a, b) =>
                a.toLowerCase().localeCompare(b.toLowerCase()),
            ),
            datatypes: Array.from(sessionResponse.dataTypes).sort((a, b) =>
                a.toLowerCase().localeCompare(b.toLowerCase()),
            ),
        });
    }

    override dispose(): void {
        super.dispose();
        this.schemaDesignerService.disposeSession({
            sessionId: this.sessionId,
        });
    }
}
