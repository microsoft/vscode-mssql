/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import { SchemaDesigner } from "../sharedInterfaces/schemaDesigner";
import VscodeWrapper from "../controllers/vscodeWrapper";
import * as LocConstants from "../constants/locConstants";
import { TreeNodeInfo } from "../objectExplorer/treeNodeInfo";
import MainController from "../controllers/mainController";

export class SchemaDesignerWebviewController extends ReactWebviewPanelController<
    SchemaDesigner.SchemaDesignerWebviewState,
    SchemaDesigner.SchemaDesignerReducers
> {
    private _sessionId: string = "";
    private _resolveModelReadyProgress: (value: void | PromiseLike<void>) => void;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private mainController: MainController,
        private schemaDesignerService: SchemaDesigner.ISchemaDesignerService,
        private connectionUri: string,
        private databaseName: string,
        private treeNode: TreeNodeInfo,
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
                report: {
                    reports: [],
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
    }

    private registerServiceEvents() {
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: LocConstants.SchemaDesigner.LoadingSchemaDesginerModel,
                cancellable: false,
            },
            (_progress, _token) => {
                const p = new Promise<void>((resolve) => {
                    this._resolveModelReadyProgress = resolve;
                });
                return p;
            },
        );
        this.schemaDesignerService.onSchemaReady((model) => {
            if (model.sessionId === this._sessionId) {
                this._resolveModelReadyProgress();
                this.postNotification("isModelReady", {
                    isModelReady: true,
                });
            }
        });
    }

    private registerReducers() {
        this.registerRequestHandler("exportToFile", async (payload) => {
            const outputPath = await vscode.window.showSaveDialog({
                filters: {
                    [payload.format]: [payload.format],
                },
                defaultUri: vscode.Uri.file(`${this.databaseName}.${payload.format}`),
                saveLabel: LocConstants.SchemaDesigner.Save,
                title: LocConstants.SchemaDesigner.SaveAs,
            });
            if (payload.format === "svg") {
                let fileContents = decodeURIComponent(payload.fileContents.split(",")[1]);
                await vscode.workspace.fs.writeFile(outputPath, Buffer.from(fileContents, "utf8"));
            } else {
                let fileContents = Buffer.from(payload.fileContents.split(",")[1], "base64");
                vscode.workspace.fs.writeFile(outputPath, fileContents);
            }
        });

        this.registerRequestHandler("initializeSchemaDesigner", async () => {
            const sessionResponse = await this.schemaDesignerService.createSession({
                connectionUri: this.connectionUri,
                databaseName: this.databaseName,
            });

            const schemaSet = new Set<string>(sessionResponse.schemaNames);
            sessionResponse.schema.tables.forEach((table) => {
                schemaSet.add(table.schema);
            });
            sessionResponse.schemaNames = Array.from(schemaSet).sort((a, b) => {
                return a.toLocaleLowerCase().localeCompare(b.toLocaleLowerCase());
            });
            this._sessionId = sessionResponse.sessionId;
            return sessionResponse;
        });

        this.registerRequestHandler("getScript", async (payload) => {
            const script = await this.schemaDesignerService.generateScript({
                updatedSchema: payload.updatedSchema,
                sessionId: this._sessionId,
            });
            return script;
        });

        this.registerRequestHandler("getReport", async (payload) => {
            try {
                const report = await this.schemaDesignerService.getReport({
                    updatedSchema: payload.updatedSchema,
                    sessionId: this._sessionId,
                });
                return {
                    report,
                };
            } catch (error) {
                return {
                    error: error.toString(),
                };
            }
        });

        this.registerRequestHandler("copyToClipboard", async (payload) => {
            await vscode.env.clipboard.writeText(payload.text);
        });

        this.registerRequestHandler("openInEditor", async (payload) => {
            const document = await this.vscodeWrapper.openMsSqlTextDocument(payload.text);
            // Open the document in the editor
            await this.vscodeWrapper.showTextDocument(document, {
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: true,
            });
        });

        this.registerRequestHandler("openInEditorWithConnection", async (payload) => {
            void this.mainController.onNewQuery(this.treeNode, payload.text);
        });
    }

    override dispose(): void {
        super.dispose();
        this._resolveModelReadyProgress();
        this.schemaDesignerService.disposeSession({
            sessionId: this._sessionId,
        });
    }
}
