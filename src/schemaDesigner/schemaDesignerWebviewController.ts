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
    private _key: string = "";
    private _isDirty: boolean = false;
    public schemaDesignerDetails: SchemaDesigner.CreateSessionResponse | undefined = undefined;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private mainController: MainController,
        private schemaDesignerService: SchemaDesigner.ISchemaDesignerService,
        private connectionString: string,
        private accessToken: string | undefined,
        private databaseName: string,
        private treeNode: TreeNodeInfo,
        private schemaDesignerCache: Map<string, SchemaDesigner.CreateSessionResponse>,
    ) {
        super(
            context,
            vscodeWrapper,
            "schemaDesigner",
            "schemaDesigner",
            {},
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

        this._key = `${this.connectionString}-${this.databaseName}`;

        this.registerReducers();
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
            let sessionResponse: SchemaDesigner.CreateSessionResponse;
            if (!this.schemaDesignerCache.has(this._key)) {
                sessionResponse = await this.schemaDesignerService.createSession({
                    connectionString: this.connectionString,
                    accessToken: this.accessToken,
                    databaseName: this.databaseName,
                });
                this._sessionId = sessionResponse.sessionId;
            } else {
                // if the cache has the session, the changes have not been saved, and the
                // session is dirty
                sessionResponse = this.schemaDesignerCache.get(this._key)!;
                this._isDirty = true;
            }
            this.schemaDesignerDetails = sessionResponse;
            return sessionResponse;
        });

        this.registerRequestHandler("getScript", async (payload) => {
            const script = await this.schemaDesignerService.generateScript({
                updatedSchema: payload.updatedSchema,
                sessionId: this._sessionId,
            });
            this.handleSchemaChanges(payload.updatedSchema);
            return script;
        });

        this.registerRequestHandler("getReport", async (payload) => {
            try {
                const report = await this.schemaDesignerService.getReport({
                    updatedSchema: payload.updatedSchema,
                    sessionId: this._sessionId,
                });
                this.handleSchemaChanges(payload.updatedSchema);
                return {
                    report,
                };
            } catch (error) {
                return {
                    error: error.toString(),
                };
            }
        });

        this.registerRequestHandler("publishSession", async (payload) => {
            try {
                await this.schemaDesignerService.publishSession({
                    sessionId: this._sessionId,
                });
                this._isDirty = false;
                return {
                    success: true,
                };
            } catch (error) {
                return {
                    success: false,
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

        this.registerRequestHandler("closeDesigner", async () => {
            this.panel.dispose();
        });
    }

    private handleSchemaChanges(updatedSchema: SchemaDesigner.Schema): void {
        this.schemaDesignerDetails!.schema = updatedSchema;
        this._isDirty = true;
    }

    override async dispose(): Promise<void> {
        if (this._isDirty) {
            const choice = await vscode.window.showInformationMessage(
                "You have unsaved changes in your schema. Are you sure you want to exit without saving?",
                { modal: true },
                "Save and Close",
                "Close without saving",
            );

            if (choice === "Save and Close") {
                // Set the schema designer details in the cache
                this.schemaDesignerCache.set(this._key, this.schemaDesignerDetails);
            } else {
                // User chose not to save, so remove the session from the cache
                // Set the schema designer details in the cache
                this.schemaDesignerCache.delete(this._key);
            }
        } else {
            this.schemaDesignerCache.delete(this._key);
        }
        super.dispose();
        this.schemaDesignerService.disposeSession({
            sessionId: this._sessionId,
        });
    }
}
