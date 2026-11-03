/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { isWrapper } from "@microsoft/vscode-azureresources-api";
import { IExtensionContextService } from "extension-toolkit/vscode";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import ConnectionManager from "../controllers/connectionManager";
import {
    getAzureResource,
    isAzureResourceTypeGroupNode,
} from "../integration/azureResourcesIntegration";
import {
    getFabricWorkspaceItemEnvironment,
    isFabricSqlDatabaseNode,
    isFabricWorkspaceItemNode,
} from "../integration/fabricIntegration";
import { IConnectionProfile } from "../models/interfaces";
import { getLogger } from "../models/logger";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { ObjectExplorerProvider } from "../objectExplorer/objectExplorerProvider";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { ConnectionManagerPerformanceResolver } from "../performance/performanceConnections";
import { PerformanceSessionPool } from "../performance/performanceSessionPool";
import { createDataPlaneHost } from "../performance/queryStoreService";
import { applyDatabaseHubContext, registerDatabaseHubServerFacts } from "./databaseHubEligibility";
import { AccountDatabaseHubAzureLookup, FabricApiDatabaseHubLookup } from "./databaseHubLookups";
import {
    DatabaseHubServerFactsDetector,
    DatabaseHubServerFactsStore,
} from "./databaseHubServerFacts";
import { DatabaseHubRequest, DatabaseHubService, DatabaseHubSource } from "./databaseHubService";

/** Server facts sessions close soon after use: a detection reads once. */
const serverFactsSessionIdleTimeoutMs = 60_000;

/**
 * Contributes Open in Database Hub to Object Explorer, the Azure Resources view, and the Fabric
 * extension's workspace view, and saves server facts after each connection.
 */
export class DatabaseHubContribution implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _service: DatabaseHubService;

    constructor(
        connectionManager: ConnectionManager,
        private readonly _objectExplorer: ObjectExplorerProvider,
        @IExtensionContextService contextService: IExtensionContextService,
    ) {
        const logger = getLogger("Fabric Database Hub");
        const store = new DatabaseHubServerFactsStore(contextService.context.globalState);
        const pool = new PerformanceSessionPool(createDataPlaneHost(), {
            idleTimeoutMs: serverFactsSessionIdleTimeoutMs,
        });
        const connections = new ConnectionManagerPerformanceResolver(connectionManager);
        const detector = new DatabaseHubServerFactsDetector(store, connections, pool, logger);
        this._service = new DatabaseHubService(
            store,
            detector,
            new AccountDatabaseHubAzureLookup(logger),
            new FabricApiDatabaseHubLookup(logger),
            async (profileId) =>
                (await connectionManager.connectionStore.connectionConfig.getConnectionById(
                    profileId,
                )) as IConnectionProfile | undefined,
            (profile) => connectionManager.getServerInfo(profile as IConnectionProfile),
            logger,
        );

        this._disposables.push(
            store,
            { dispose: () => pool.dispose() },
            this._service,
            registerDatabaseHubServerFacts((connection) => store.get(connection)),
            vscode.commands.registerCommand(Constants.cmdOpenInFabricDatabaseHub, (node: unknown) =>
                this.openNode(node),
            ),
            connectionManager.onSuccessfulConnection(({ connection }) => {
                const profile = connection.credentials as IConnectionProfile;
                if (profile?.id && profile.server && connection.serverInfo) {
                    void detector.onConnected(profile, connection.serverInfo);
                }
            }),
            store.onDidChange((connectionId) => this.refreshConnectionNode(connectionId)),
        );
    }

    public dispose(): void {
        vscode.Disposable.from(...this._disposables).dispose();
    }

    private async openNode(node: unknown): Promise<void> {
        const request = requestFor(node);
        if (!request) {
            void vscode.window.showInformationMessage(
                LocalizedConstants.DatabaseHub.notInDatabaseHub,
            );
            return;
        }
        await this._service.open(request, sourceOf(node));
    }

    /**
     * Draws a connection's Object Explorer nodes again when new facts change its menu, so the
     * database nodes under it follow too.
     */
    private refreshConnectionNode(connectionId: string): void {
        const service = this._objectExplorer.objectExplorerService;
        if (service.connections.some((profile) => profile.id === connectionId)) {
            const node = service.getConnectionNodeById(connectionId);
            if (node && applyDatabaseHubContext(node)) {
                this._objectExplorer.refresh(node);
            }
        }
    }
}

/** Maps the node a command was invoked on to what to open in the Hub. */
export function requestFor(node: unknown): DatabaseHubRequest | undefined {
    if (node instanceof TreeNodeInfo) {
        const profile = node.connectionProfile;
        if (!profile?.id || !profile.server) {
            return undefined;
        }
        const database = ObjectExplorerUtils.getDatabaseName(node);
        return {
            kind: "connection",
            profile,
            database:
                database && database !== LocalizedConstants.defaultDatabaseLabel
                    ? database
                    : undefined,
        };
    }
    if (isWrapper(node)) {
        return { kind: "azureResource", resourceId: getAzureResource(node).id };
    }
    if (isAzureResourceTypeGroupNode(node)) {
        return { kind: "azureSubscription", subscriptionId: node.subscription?.subscriptionId };
    }
    if (isFabricWorkspaceItemNode(node) && isFabricSqlDatabaseNode(node)) {
        return {
            kind: "fabricItem",
            itemId: node.artifact.id,
            environment: getFabricWorkspaceItemEnvironment(node),
        };
    }
    return undefined;
}

function sourceOf(node: unknown): DatabaseHubSource {
    if (node instanceof TreeNodeInfo) {
        return DatabaseHubSource.ObjectExplorer;
    }
    if (isWrapper(node) || isAzureResourceTypeGroupNode(node)) {
        return DatabaseHubSource.AzureResources;
    }
    if (isFabricWorkspaceItemNode(node)) {
        return DatabaseHubSource.FabricWorkspace;
    }
    return DatabaseHubSource.Unknown;
}
