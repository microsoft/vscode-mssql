/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ObjectExplorerService } from "../objectExplorer/objectExplorerService";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { ConnectionNode } from "../objectExplorer/nodes/connectionNode";
import { IConnectionInfo } from "vscode-mssql";
import { ILogger, logger } from "../models/logger";
import { getErrorMessage } from "../utils/utils";
import {
    acquireTokenFromVscodeAccountForResource,
    getCloudResourceEndpoint,
} from "../azure/vscodeEntraMfaUtils";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";

const FABRIC_EXTENSION_ID = "fabric.vscode-fabric";
const MSSQL_EXTENSION_ID = "ms-mssql.mssql";
/** API version string must match the major.minor of the Fabric extension's vscode-fabric-api package. */
const FABRIC_API_VERSION = "0.7";

const _fabricLogger = logger.withPrefix("[Fabric]");

// ---------------------------------------------------------------------------
// Minimal structural types for @microsoft/vscode-fabric-api
// We use duck-typing / structural compatibility rather than importing the
// package, since mssql and Fabric bundle different package instances.
// ---------------------------------------------------------------------------

interface IFabricArtifact {
    id: string;
    type: string;
    displayName: string;
    description?: string;
    workspaceId: string;
    fabricEnvironment: string;
}

interface IFabricApiClient {
    sendRequest(options: { pathTemplate?: string; method?: string }): Promise<{
        status: number;
        parsedBody?: any;
    }>;
}

interface IFabricExtension {
    identity: string;
    apiVersion: string;
    artifactTypes: string[];
    treeNodeProviders?: IFabricTreeNodeProvider[];
}

interface IFabricExtensionServiceCollection {
    apiClient: IFabricApiClient;
}

interface IFabricExtensionManager {
    addExtension(extension: IFabricExtension): IFabricExtensionServiceCollection;
}

interface IFabricTreeNodeProvider {
    artifactType: string;
    createArtifactTreeNode(artifact: IFabricArtifact): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// OE wrapper node — presented as a child node in the Fabric workspace tree
// ---------------------------------------------------------------------------

/**
 * Wraps a mssql Object Explorer `TreeNodeInfo` as a VS Code `TreeItem` for use
 * in the Fabric workspace tree view. Implements `unwrap()` so that mssql context
 * menu commands can recover the underlying `TreeNodeInfo` via
 * `resolveObjectExplorerNode()`.
 */
export class MssqlOeWrapperFabricTreeNode extends vscode.TreeItem {
    constructor(
        private readonly _oeNode: TreeNodeInfo,
        private readonly _oeService: ObjectExplorerService,
    ) {
        super(
            _oeNode.label ?? "",
            _oeNode.collapsibleState ?? vscode.TreeItemCollapsibleState.None,
        );
        this.id = _oeNode.id;
        this.iconPath = _oeNode.iconPath;
        this.contextValue = _oeNode.contextValue;
        this.tooltip = _oeNode.tooltip;
        this.description = _oeNode.description;
        this.command = _oeNode.command;
    }

    /** Called by the Fabric tree data provider to get child nodes. */
    public async getChildNodes(): Promise<MssqlOeWrapperFabricTreeNode[]> {
        const sessionId = this._oeNode.sessionId;
        if (!sessionId) {
            return [];
        }
        const children = await this._oeService.expandNode(this._oeNode, sessionId);
        return (children ?? []).map(
            (n) => new MssqlOeWrapperFabricTreeNode(n as TreeNodeInfo, this._oeService),
        );
    }

    /** Returns the underlying `TreeNodeInfo` for mssql command handlers. */
    public unwrap(): TreeNodeInfo {
        return this._oeNode;
    }
}

// ---------------------------------------------------------------------------
// Top-level artifact node — shown in place of the default Fabric SQL item node
// ---------------------------------------------------------------------------

/**
 * An `ArtifactTreeNode`-compatible tree item for a Fabric SQL artifact
 * (SQLDatabase, SQLEndpoint, or Warehouse) that expands inline to show the
 * mssql Object Explorer database tree.
 *
 * Sets `isArtifactTreeNode = true` so that the Fabric workspace tree view
 * correctly identifies it as an artifact node via the discriminator check.
 */
export class MssqlFabricDatabaseTreeNode extends vscode.TreeItem {
    /** Discriminator used by the Fabric tree view instead of `instanceof`. */
    readonly isArtifactTreeNode = true as const;

    /** Populated after the first expansion; used by `unwrap()` for command context. */
    private _connectionNode: ConnectionNode | undefined;

    constructor(
        public readonly artifact: IFabricArtifact,
        private readonly _getOeChildren: () => Promise<{
            children: MssqlOeWrapperFabricTreeNode[];
            connectionNode: ConnectionNode;
        }>,
    ) {
        super(artifact.displayName, vscode.TreeItemCollapsibleState.Collapsed);
        // Include Fabric satellite contextValue tokens so Fabric's own commands
        // (Open in SQL Extension, Copy Connection String) remain visible, plus
        // `type=Database` so that mssql database-level menu items are shown too.
        this.contextValue = `Item${artifact.type}notopen|item-open-in-sql|item-copy-connection-string|type=Database`;
        this.tooltip = artifact.displayName;
        // Stable ID matching the pattern used by ArtifactTreeNode
        const envPart = artifact.fabricEnvironment || "unknown";
        this.id = `art:${envPart}:${artifact.workspaceId}:${artifact.type}:${artifact.id}`;
    }

    /** Called by the Fabric tree data provider to get child nodes. */
    public async getChildNodes(): Promise<MssqlOeWrapperFabricTreeNode[]> {
        const { children, connectionNode } = await this._getOeChildren();
        this._connectionNode = connectionNode;
        return children;
    }

    /**
     * Returns the cached OE `ConnectionNode` so that mssql command handlers can
     * recover connection context via `resolveObjectExplorerNode()`.
     * Returns `undefined` until the node has been expanded at least once.
     */
    public unwrap(): ConnectionNode | undefined {
        return this._connectionNode;
    }
}

// ---------------------------------------------------------------------------
// Per-artifact-type provider
// ---------------------------------------------------------------------------

type ConnectionResolver = (
    apiClient: IFabricApiClient,
    artifact: IFabricArtifact,
) => Promise<{ server: string; database?: string }>;

class MssqlFabricTreeNodeProvider implements IFabricTreeNodeProvider {
    /** Set after `addExtension()` returns the service collection. */
    public apiClient: IFabricApiClient | undefined;

    constructor(
        public readonly artifactType: string,
        private readonly _oeService: ObjectExplorerService,
        private readonly _logger: ILogger,
        private readonly _resolveConnection: ConnectionResolver,
    ) {}

    async createArtifactTreeNode(artifact: IFabricArtifact): Promise<MssqlFabricDatabaseTreeNode> {
        const apiClient = this.apiClient;
        const logger = this._logger;
        const oeService = this._oeService;
        const resolveConnection = this._resolveConnection;

        return new MssqlFabricDatabaseTreeNode(artifact, async () => {
            if (!apiClient) {
                throw new Error("Fabric API client not available");
            }
            const { server, database } = await resolveConnection(apiClient, artifact);
            return _createOeChildren(oeService, logger, server, database, artifact.displayName);
        });
    }
}

// ---------------------------------------------------------------------------
// OE session creation helper
// ---------------------------------------------------------------------------

async function _createOeChildren(
    oeService: ObjectExplorerService,
    logger: ILogger,
    server: string,
    database: string | undefined,
    displayName: string,
): Promise<{ children: MssqlOeWrapperFabricTreeNode[]; connectionNode: ConnectionNode }> {
    logger.info(`Creating OE session for Fabric item "${displayName}" (server: ${server})`);

    // Use any available VS Code Azure account; prompt to sign in if none found.
    const accounts = await VsCodeAzureHelper.getAccounts();
    const account = accounts[0];

    const tokenInfo = await acquireTokenFromVscodeAccountForResource(
        getCloudResourceEndpoint("sqlResource"),
        account?.id,
        undefined,
        account?.label,
        { promptIfMissing: accounts.length === 0 },
    );

    const connectionInfo: IConnectionInfo = {
        server,
        database: database ?? "",
        user: tokenInfo.account.label,
        password: "",
        email: tokenInfo.account.label,
        accountId: tokenInfo.account.id,
        tenantId: tokenInfo.tenantId,
        port: 0,
        authenticationType: "AzureMFA",
        azureAccountToken: tokenInfo.token.token,
        expiresOn: tokenInfo.token.expiresOn,
        encrypt: "Mandatory",
        trustServerCertificate: false,
        hostNameInCertificate: undefined,
        persistSecurityInfo: undefined,
        secureEnclaves: undefined,
        columnEncryptionSetting: undefined,
        attestationProtocol: undefined,
        enclaveAttestationUrl: undefined,
        connectTimeout: undefined,
        commandTimeout: undefined,
        connectRetryCount: undefined,
        connectRetryInterval: undefined,
        applicationName: undefined,
        workstationId: undefined,
        applicationIntent: undefined,
        currentLanguage: undefined,
        pooling: undefined,
        maxPoolSize: undefined,
        minPoolSize: undefined,
        loadBalanceTimeout: undefined,
        replication: undefined,
        attachDbFilename: undefined,
        failoverPartner: undefined,
        multiSubnetFailover: undefined,
        multipleActiveResultSets: undefined,
        packetSize: undefined,
        typeSystemVersion: undefined,
        connectionString: undefined,
        containerName: undefined,
    };

    const sessionResult = await oeService.createSession(connectionInfo);
    if (!sessionResult?.connectionNode) {
        throw new Error(
            `Could not create an Object Explorer session for "${displayName}". ` +
                `Check the server name and your permissions.`,
        );
    }

    logger.info(
        `OE session ready for Fabric item "${displayName}" (sessionId: ${sessionResult.sessionId})`,
    );

    const children = await oeService.expandNode(
        sessionResult.connectionNode,
        sessionResult.sessionId,
    );
    return {
        children: (children ?? []).map(
            (n) => new MssqlOeWrapperFabricTreeNode(n as TreeNodeInfo, oeService),
        ),
        connectionNode: sessionResult.connectionNode,
    };
}

// ---------------------------------------------------------------------------
// Registration entry point
// ---------------------------------------------------------------------------

/**
 * Registers mssql as a Microsoft Fabric satellite extension, providing expandable
 * Object Explorer tree nodes for SQLDatabase, SQLEndpoint, and Warehouse artifacts
 * in the Fabric workspace sidebar.
 *
 * This is a no-op when the Fabric extension is not installed.
 */
export async function registerFabricIntegration(
    oeService: ObjectExplorerService,
    logger: ILogger,
    _ctx: vscode.ExtensionContext,
): Promise<void> {
    const fabricExt = vscode.extensions.getExtension<IFabricExtensionManager>(FABRIC_EXTENSION_ID);
    if (!fabricExt) {
        logger.info("Fabric extension not installed; skipping Fabric integration.");
        return;
    }

    try {
        logger.info("Fabric extension found; registering as satellite...");
        const core = fabricExt.isActive ? fabricExt.exports : await fabricExt.activate();
        if (!core || typeof core.addExtension !== "function") {
            logger.warn("Fabric extension did not export a valid extension manager.");
            return;
        }

        // ------------------------------------------------------------------
        // SQLDatabase — GET /v1/workspaces/{wid}/sqlDatabases/{id}
        // ------------------------------------------------------------------
        const sqlDbProvider = new MssqlFabricTreeNodeProvider(
            "SQLDatabase",
            oeService,
            _fabricLogger,
            async (apiClient, artifact) => {
                const resp = await apiClient.sendRequest({
                    pathTemplate: `/v1/workspaces/${artifact.workspaceId}/sqlDatabases/${artifact.id}`,
                    method: "GET",
                });
                if (resp.status !== 200) {
                    throw new Error(`SQLDatabase API returned ${resp.status}`);
                }
                const props = resp.parsedBody?.properties;
                return {
                    server: (props.serverFqdn as string).split(",")[0],
                    database: props.databaseName as string,
                };
            },
        );

        // ------------------------------------------------------------------
        // SQLEndpoint — GET /v1/workspaces/{wid}/sqlEndpoints/{id}/connectionString
        // ------------------------------------------------------------------
        const sqlEpProvider = new MssqlFabricTreeNodeProvider(
            "SQLEndpoint",
            oeService,
            _fabricLogger,
            async (apiClient, artifact) => {
                const resp = await apiClient.sendRequest({
                    pathTemplate: `/v1/workspaces/${artifact.workspaceId}/sqlEndpoints/${artifact.id}/connectionString`,
                    method: "GET",
                });
                if (resp.status !== 200) {
                    throw new Error(`SQLEndpoint API returned ${resp.status}`);
                }
                return { server: resp.parsedBody?.connectionString as string };
            },
        );

        // ------------------------------------------------------------------
        // Warehouse — GET /v1/workspaces/{wid}/warehouses/{id}
        // ------------------------------------------------------------------
        const warehouseProvider = new MssqlFabricTreeNodeProvider(
            "Warehouse",
            oeService,
            _fabricLogger,
            async (apiClient, artifact) => {
                const resp = await apiClient.sendRequest({
                    pathTemplate: `/v1/workspaces/${artifact.workspaceId}/warehouses/${artifact.id}`,
                    method: "GET",
                });
                if (resp.status !== 200) {
                    throw new Error(`Warehouse API returned ${resp.status}`);
                }
                const props = resp.parsedBody?.properties;
                return {
                    server: props.connectionString as string,
                    database: (resp.parsedBody?.displayName as string) ?? undefined,
                };
            },
        );

        const fabricExtension: IFabricExtension = {
            identity: MSSQL_EXTENSION_ID,
            apiVersion: FABRIC_API_VERSION,
            artifactTypes: ["SQLDatabase", "SQLEndpoint", "Warehouse"],
            treeNodeProviders: [sqlDbProvider, sqlEpProvider, warehouseProvider],
        };

        const services = core.addExtension(fabricExtension);

        // Wire the apiClient into providers AFTER addExtension() returns the service collection.
        sqlDbProvider.apiClient = services.apiClient;
        sqlEpProvider.apiClient = services.apiClient;
        warehouseProvider.apiClient = services.apiClient;

        logger.info("Fabric satellite extension registered successfully.");
    } catch (err) {
        logger.warn(`Failed to register Fabric integration: ${getErrorMessage(err)}`);
    }
}
