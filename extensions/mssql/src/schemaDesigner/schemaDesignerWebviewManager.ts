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
import {
    configSchemaDesignerEngine,
    extensionConfigSectionName,
    schemaDesignerEngineInMemory,
} from "../constants/constants";
import { SchemaDesignerInMemoryService } from "../services/schemaDesignerInMemoryService";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { randomUUID } from "crypto";
import * as Utils from "../models/utils";

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
        let preparedConnectionInfo: IConnectionProfile | undefined;
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
            preparedConnectionInfo = connectionInfo;
        } else if (connectionUri) {
            const existingConnection =
                mainController.connectionManager.getConnectionInfo(connectionUri);
            if (!existingConnection) {
                throw new Error("Unable to find connection info for Schema Designer.");
            }

            let clonedConnection = Utils.deepClone(
                existingConnection.credentials,
            ) as IConnectionProfile;
            clonedConnection.database = databaseName;
            clonedConnection = (await mainController.connectionManager.prepareConnectionInfo(
                clonedConnection,
            )) as IConnectionProfile;

            const connectionDetails =
                await mainController.connectionManager.createConnectionDetails(clonedConnection);
            connectionString = await mainController.connectionManager.getConnectionString(
                connectionDetails,
                true,
                true,
            );
            azureAccountToken = clonedConnection.azureAccountToken;
            preparedConnectionInfo = clonedConnection;
        }

        const key = `${connectionString}-${databaseName}`;
        const configuration = vscode.workspace.getConfiguration(extensionConfigSectionName);
        const engineSetting = (
            configuration.get<string>(configSchemaDesignerEngine) ?? "dacfx"
        ).toLowerCase();
        const useInMemoryEngine = engineSetting === schemaDesignerEngineInMemory;
        if (useInMemoryEngine) {
            const baseConnection = preparedConnectionInfo;
            if (!baseConnection) {
                throw new Error("Schema Designer requires a connection profile to initialize.");
            }
            const ownerUri = `${baseConnection.server ?? "schemaDesigner"}-${databaseName}-schemaDesigner-${randomUUID()}`;
            const connected = await mainController.connectionManager.connect(
                ownerUri,
                baseConnection,
                {
                    connectionSource: "schemaDesigner",
                },
            );
            if (!connected) {
                throw new Error("Unable to establish connection for Schema Designer.");
            }
            connectionUri = ownerUri;
        } else if (!connectionUri && preparedConnectionInfo) {
            const existingOwnerUri =
                mainController.connectionManager.getUriForConnection(preparedConnectionInfo);
            if (existingOwnerUri) {
                connectionUri = existingOwnerUri;
            }
        }
        const serviceForController = useInMemoryEngine
            ? new SchemaDesignerInMemoryService(
                  SqlToolsServiceClient.instance,
                  mainController.connectionManager,
              )
            : schemaDesignerService;

        if (!this.schemaDesigners.has(key) || this.schemaDesigners.get(key)?.isDisposed) {
            const schemaDesigner = new SchemaDesignerWebviewController(
                context,
                vscodeWrapper,
                mainController,
                serviceForController,
                connectionString,
                azureAccountToken,
                databaseName,
                this.schemaDesignerCache,
                treeNode,
                connectionUri,
                useInMemoryEngine ? schemaDesignerEngineInMemory : "dacfx",
                preparedConnectionInfo,
            );
            schemaDesigner.onDisposed(async () => {
                this.schemaDesigners.delete(key);
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
                        serviceForController.disposeSession({
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
        return this.schemaDesigners.get(key)!;
    }
}
