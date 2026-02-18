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
    private schemaDesignerSchemaHashes: Map<string, string> = new Map();

    /**
     * Reference to the most recently visible schema designer.
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
     * Gets the currently active schema designer (most recently visible).
     * Returns undefined if no visible designer is active.
     */
    public getActiveDesigner(): SchemaDesignerWebviewController | undefined {
        if (
            this._activeDesigner?.isDisposed ||
            (this._activeDesigner && !this._activeDesigner.panel.visible)
        ) {
            this._activeDesigner = undefined;
        }
        return this._activeDesigner;
    }

    public getSchemaHash(cacheKey: string): string | undefined {
        return this.schemaDesignerSchemaHashes.get(cacheKey);
    }

    public setSchemaHash(cacheKey: string, hash: string): void {
        this.schemaDesignerSchemaHashes.set(cacheKey, hash);
    }

    public clearSchemaHash(cacheKey: string): void {
        this.schemaDesignerSchemaHashes.delete(cacheKey);
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
            const viewStateDisposable = schemaDesigner.panel.onDidChangeViewState((event) => {
                if (event.webviewPanel.visible) {
                    this._activeDesigner = schemaDesigner;
                } else if (this._activeDesigner === schemaDesigner) {
                    this._activeDesigner = undefined;
                }
            });
            schemaDesigner.onDisposed(async () => {
                viewStateDisposable.dispose();
                this.schemaDesigners.delete(key);
                this.schemaDesignerSchemaHashes.delete(key);
                if (this._activeDesigner === schemaDesigner) {
                    this._activeDesigner = undefined;
                }
                const cacheItem = this.schemaDesignerCache.get(key);
                if (cacheItem?.isDirty) {
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
                    if (cacheItem?.schemaDesignerDetails?.sessionId) {
                        schemaDesignerService.disposeSession({
                            sessionId: cacheItem.schemaDesignerDetails.sessionId,
                        });
                    }
                } catch (error) {
                    console.error(`Error disposing schema designer session: ${error}`);
                }
                this.schemaDesignerCache.delete(key);
            });
            this.schemaDesigners.set(key, schemaDesigner);
        }
        const designer = this.schemaDesigners.get(key)!;
        this._activeDesigner = designer;
        return designer;
    }
}
