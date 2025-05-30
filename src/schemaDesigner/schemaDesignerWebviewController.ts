/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import { SchemaDesigner } from "../sharedInterfaces/schemaDesigner";
import VscodeWrapper from "../controllers/vscodeWrapper";
import * as LocConstants from "../constants/locConstants";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import MainController from "../controllers/mainController";

export class SchemaDesignerWebviewController extends ReactWebviewPanelController<
    SchemaDesigner.SchemaDesignerWebviewState,
    SchemaDesigner.SchemaDesignerReducers
> {
    private _sessionId: string = "";
    private _key: string = "";
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
        private schemaDesignerCache: Map<string, SchemaDesigner.SchemaDesignerCacheItem>,
    ) {
        super(
            context,
            vscodeWrapper,
            "schemaDesigner",
            "schemaDesigner",
            {},
            {
                title: LocConstants.SchemaDesigner.tabTitle(databaseName),
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
                this.schemaDesignerCache.set(this._key, {
                    schemaDesignerDetails: sessionResponse,
                    isDirty: false,
                });
            } else {
                // if the cache has the session, the changes have not been saved, and the
                // session is dirty
                sessionResponse = this.updateCacheItem(undefined, true).schemaDesignerDetails;
            }
            this.schemaDesignerDetails = sessionResponse;
            this._sessionId = sessionResponse.sessionId;
            return sessionResponse;
        });

        this.registerRequestHandler("getDefinition", async (payload) => {
            const script = await this.schemaDesignerService.getDefinition({
                updatedSchema: payload.updatedSchema,
                sessionId: this._sessionId,
            });
            this.updateCacheItem(payload.updatedSchema, true);
            return script;
        });

        this.registerRequestHandler("getReport", async (payload) => {
            try {
                return await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: "Generating report. This might take a while...",
                        cancellable: false,
                    },
                    async () => {
                        // Wait for the report to be generated
                        const report = await this.schemaDesignerService.getReport({
                            updatedSchema: payload.updatedSchema,
                            sessionId: this._sessionId,
                        });
                        this.updateCacheItem(payload.updatedSchema, true);
                        return {
                            report,
                        };
                    },
                );
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
                this.updateCacheItem(undefined, false);
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
            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Opening publish script. This might take a while...",
                    cancellable: false,
                },
                async () => {
                    const result = await this.schemaDesignerService.generateScript({
                        sessionId: this._sessionId,
                    });
                    // Open the document in the editor with the connection
                    void this.mainController.onNewQuery(this.treeNode, result?.script);
                },
            );
        });

        this.registerRequestHandler("closeDesigner", async () => {
            this.panel.dispose();
        });
    }

    private updateCacheItem(
        updatedSchema?: SchemaDesigner.Schema,
        isDirty?: boolean,
    ): SchemaDesigner.SchemaDesignerCacheItem {
        let schemaDesignerCacheItem = this.schemaDesignerCache.get(this._key)!;
        if (updatedSchema) {
            this.schemaDesignerDetails!.schema = updatedSchema;
            schemaDesignerCacheItem.schemaDesignerDetails.schema = updatedSchema;
        }
        // if isDirty is not provided, set it to schemaDesignerCacheItem.isDirty
        // else, set it to the provided value
        schemaDesignerCacheItem.isDirty = isDirty ?? schemaDesignerCacheItem.isDirty;
        this.schemaDesignerCache.set(this._key, schemaDesignerCacheItem);
        return schemaDesignerCacheItem;
    }

    override async dispose(): Promise<void> {
        this.updateCacheItem(this.schemaDesignerDetails!.schema);
        super.dispose();
    }
}
