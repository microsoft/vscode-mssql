/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { SchemaDesigner } from "../sharedInterfaces/schemaDesigner";
import { SchemaDesignerWebviewController } from "./schemaDesignerWebviewController";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import MainController from "../controllers/mainController";
import * as LocConstants from "../constants/locConstants";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";
import { sendActionEvent } from "../telemetry/telemetry";

export class SchemaDesignerWebviewManager {
    private static instance: SchemaDesignerWebviewManager;
    private schemaDesigners: Map<string, SchemaDesignerWebviewController> = new Map();
    private schemaDesignerCache: Map<string, SchemaDesigner.SchemaDesignerCacheItem> = new Map();

    public static getInstance(): SchemaDesignerWebviewManager {
        if (!this.instance) {
            this.instance = new SchemaDesignerWebviewManager();
        }
        return this.instance;
    }

    private constructor() {
        // Private constructor to prevent instantiation
    }

    public async getSchemaDesigner(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        mainController: MainController,
        schemaDesignerService: SchemaDesigner.ISchemaDesignerService,
        databaseName: string,
        treeNode: TreeNodeInfo,
    ): Promise<SchemaDesignerWebviewController> {
        const connectionInfo = treeNode.connectionProfile;
        connectionInfo.database = databaseName;

        const connectionDetails =
            await mainController.connectionManager.createConnectionDetails(connectionInfo);

        await mainController.connectionManager.confirmEntraTokenValidity(connectionInfo);

        const connectionString = await mainController.connectionManager.getConnectionString(
            connectionDetails,
            true,
            true,
        );

        const key = `${connectionString}-${databaseName}`;
        if (!this.schemaDesigners.has(key)) {
            const schemaDesigner = new SchemaDesignerWebviewController(
                context,
                vscodeWrapper,
                mainController,
                schemaDesignerService,
                connectionString,
                connectionInfo.azureAccountToken,
                databaseName,
                treeNode,
                this.schemaDesignerCache,
            );
            schemaDesigner.onDisposed(async () => {
                this.schemaDesigners.delete(key);
                if (this.schemaDesignerCache.get(key).isDirty) {
                    // Ensure the user wants to exit without saving
                    const choice = await vscode.window.showInformationMessage(
                        LocConstants.Webview.webviewRestorePrompt(
                            LocConstants.SchemaDesigner.SchemaDesigner,
                        ),
                        { modal: true },
                        LocConstants.Webview.Restore,
                    );

                    if (choice === LocConstants.Webview.Restore) {
                        sendActionEvent(
                            TelemetryViews.WebviewController,
                            TelemetryActions.Restore,
                            {},
                            {},
                        );
                        // Show the webview again
                        return await this.getSchemaDesigner(
                            context,
                            vscodeWrapper,
                            mainController,
                            schemaDesignerService,
                            databaseName,
                            treeNode,
                        );
                    }
                }
                schemaDesignerService.disposeSession({
                    sessionId: this.schemaDesignerCache.get(key).schemaDesignerDetails.sessionId,
                });
                this.schemaDesignerCache.delete(key);
            });
            this.schemaDesigners.set(key, schemaDesigner);
        }
        return this.schemaDesigners.get(key)!;
    }
}
