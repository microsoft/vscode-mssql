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
import { IConnectionProfile } from "../models/interfaces";

export class SchemaDesignerWebviewManager {
    private static instance: SchemaDesignerWebviewManager;
    private schemaDesigners: Map<string, SchemaDesignerWebviewController> = new Map();
    private schemaDesignerCache: Map<string, SchemaDesigner.SchemaDesignerCacheItem> = new Map();

    /**
     * Reference to the most recently created/accessed schema designer (for POC purposes)
     */
    private _activeDesigner: SchemaDesignerWebviewController | undefined;

    public static getInstance(): SchemaDesignerWebviewManager {
        if (!this.instance) {
            this.instance = new SchemaDesignerWebviewManager();
        }
        return this.instance;
    }

    private constructor() {
        // Private constructor to prevent instantiation
    }

    /**
     * Gets the currently active schema designer (most recently accessed).
     * Returns undefined if no designer is active.
     */
    public getActiveDesigner(): SchemaDesignerWebviewController | undefined {
        if (this._activeDesigner?.isDisposed) {
            this._activeDesigner = undefined;
        }
        return this._activeDesigner;
    }

    /**
     * Gets or creates a schema designer webview controller for the specified database connection.
     * This method manages the lifecycle of schema designer instances, reusing existing ones when possible.
     *
     * @param context - The VS Code extension context
     * @param vscodeWrapper - Wrapper for VS Code APIs
     * @param mainController - The main controller instance
     * @param schemaDesignerService - Service for schema designer operations
     * @param databaseName - Name of the database to open in the schema designer
     * @param treeNode - Optional tree node info containing connection profile. If provided, connection details will be extracted from this node
     * @param connectionUri - Optional connection URI. Used when treeNode is not provided to establish database connection
     * @returns Promise that resolves to a SchemaDesignerWebviewController instance
     *
     * @remarks
     * - Either treeNode or connectionUri must be provided to establish a database connection
     */
    public async getSchemaDesigner(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        mainController: MainController,
        schemaDesignerService: SchemaDesigner.ISchemaDesignerService,
        databaseName: string,
        treeNode?: TreeNodeInfo,
        connectionUri?: string,
    ): Promise<SchemaDesignerWebviewController> {
        let connectionString: string | undefined;
        let azureAccountToken: string | undefined;
        if (treeNode) {
            let connectionInfo = treeNode.connectionProfile;
            connectionInfo = (await mainController.connectionManager.prepareConnectionInfo(
                connectionInfo,
            )) as IConnectionProfile;
            connectionInfo.database = databaseName;

            const connectionDetails =
                await mainController.connectionManager.createConnectionDetails(connectionInfo);

            treeNode.updateConnectionProfile(connectionInfo);

            connectionString = await mainController.connectionManager.getConnectionString(
                connectionDetails,
                true,
                true,
            );
            azureAccountToken = connectionInfo.azureAccountToken;
        } else if (connectionUri) {
            var connInfo = mainController.connectionManager.getConnectionInfo(connectionUri);
            connectionString = await mainController.connectionManager.getConnectionString(
                connectionUri,
                true,
                true,
            );
            azureAccountToken = connInfo.credentials.azureAccountToken;
        }

        const key = `${connectionString}-${databaseName}`;
        if (!this.schemaDesigners.has(key) || this.schemaDesigners.get(key)?.isDisposed) {
            const schemaDesigner = new SchemaDesignerWebviewController(
                context,
                vscodeWrapper,
                mainController,
                schemaDesignerService,
                connectionString,
                azureAccountToken,
                databaseName,
                this.schemaDesignerCache,
                treeNode,
                connectionUri,
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
                            connectionUri,
                        );
                    }
                }
                // Ignoring errors here as we don't want to block the disposal process
                try {
                    schemaDesignerService.disposeSession({
                        sessionId:
                            this.schemaDesignerCache.get(key).schemaDesignerDetails.sessionId,
                    });
                } catch (error) {
                    console.error(`Error disposing schema designer session: ${error}`);
                }
                this.schemaDesignerCache.delete(key);
            });
            this.schemaDesigners.set(key, schemaDesigner);
        }
        const designer = this.schemaDesigners.get(key)!;
        this._activeDesigner = designer; // Track the active designer for POC
        return designer;
    }
}
