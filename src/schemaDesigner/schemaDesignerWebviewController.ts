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
                console.log("Model ready");
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
    }

    private async createNewSession() {
        const sessionResponse = await this.schemaDesignerService.createSession({
            connectionUri: this.connectionUri,
            databaseName: this.databaseName,
        });
        this.sessionId = sessionResponse.sessionId;
        this.updateState({
            schema: sessionResponse.schema,
        });
        await this.getScript();
    }

    private async getScript() {
        const script = await this.schemaDesignerService.generateScript({
            updatedSchema: this.state.schema,
            sessionId: this.sessionId,
        });
        console.log("Script generated", script);
    }

    override dispose(): void {
        super.dispose();
        this.schemaDesignerService.disposeSession({
            sessionId: this.sessionId,
        });
    }
}
