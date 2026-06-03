/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    AzureResource,
    AzureResourceBranchDataProvider,
} from "@microsoft/vscode-azureresources-api";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { ObjectExplorerService } from "../objectExplorer/objectExplorerService";
import { ConnectionNode } from "../objectExplorer/nodes/connectionNode";
import { IConnectionInfo } from "vscode-mssql";
import { getErrorMessage } from "../utils/utils";
import {
    acquireTokenFromVscodeAccountForResource,
    getCloudResourceEndpoint,
} from "./vscodeEntraMfaUtils";
import { ILogger, logger } from "../models/logger";

const _azResourcesLogger = logger.withPrefix("Azure Resources");

/**
 * Lightweight placeholder returned synchronously by `getResourceItem`.
 * The OE session is created lazily the first time the user expands the node.
 */
export interface SqlServerRootModel {
    /** ARM resource ID — required by ResourceModelBase */
    readonly id: string;
    readonly resource: AzureResource;
    /** Populated on first expansion */
    connectionNode?: ConnectionNode;
    /** Populated on first expansion */
    sessionId?: string;
}

/** Union type covering both the server root and any OE child node */
export type SqlBranchModel = SqlServerRootModel | TreeNodeInfo;

export function isSqlServerRootModel(node: unknown): node is SqlServerRootModel {
    return typeof node === "object" && node !== null && "resource" in node && !("nodePath" in node);
}

/**
 * Resolves a command argument to a `TreeNodeInfo`, handling both direct OE items and items
 * wrapped in the Azure Resources `BranchDataItemWrapper` (which has an `unwrap()` method).
 *
 * When a context menu command fires from the Azure Resources tree VS Code passes the
 * `BranchDataItemWrapper`, not the raw model.  This helper unwraps it transparently so
 * command handlers don't have to know which view they were invoked from.
 *
 * If the item cannot be resolved (unknown wrapper type), logs a warning and returns the original.
 */
export function resolveObjectExplorerNode(item: TreeNodeInfo): TreeNodeInfo {
    if (item instanceof TreeNodeInfo) {
        return item;
    }
    // BranchDataItemWrapper from Azure Resources extension exposes unwrap()
    const maybeWrapper = item as { unwrap?: () => unknown } | null | undefined;
    if (maybeWrapper && typeof maybeWrapper.unwrap === "function") {
        const inner = maybeWrapper.unwrap();
        if (inner instanceof TreeNodeInfo) {
            return inner;
        }
        // SqlServerRootModel — the connection node is populated after first expansion
        if (isSqlServerRootModel(inner) && inner.connectionNode) {
            return inner.connectionNode;
        }
        // MssqlFabricDatabaseTreeNode.unwrap() returns ConnectionNode | undefined
        // (ConnectionNode extends TreeNodeInfo so the first check handles the defined case)
        if (inner === undefined) {
            _azResourcesLogger.warn(
                `Could not resolve wrapped node for "${(item as TreeNodeInfo).label ?? String(item)}" — expand it first to establish a connection.`,
            );
            return item;
        }
        _azResourcesLogger.warn(
            `Could not resolve wrapped node for "${(item as TreeNodeInfo).label ?? String(item)}"`,
        );
    }
    return item;
}

/**
 * A BranchDataProvider that integrates the mssql Object Explorer into the Azure Resources sidebar.
 * Each Azure SQL Server resource is shown as a connection node that can be expanded to reveal
 * the full database tree (same as the mssql Object Explorer panel).
 *
 * Authentication always uses the Entra identity that the Azure Resources extension is browsing
 * with — the token is obtained from the resource's subscription authentication context rather
 * than from any saved mssql connection profile.
 *
 * Design: `getResourceItem` returns a lightweight placeholder immediately (no network calls).
 * The OE session is established lazily in `getChildren` when the user first expands a server.
 */
export class SqlServerBranchDataProvider
    implements AzureResourceBranchDataProvider<SqlBranchModel>
{
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<
        SqlBranchModel | SqlBranchModel[] | undefined | null | void
    >();

    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly _refreshListenerDisposable: vscode.Disposable;

    constructor(
        private readonly _objectExplorerService: ObjectExplorerService,
        private readonly _logger: ILogger,
    ) {
        // Mirror OE-service refresh events into our own onDidChangeTreeData so the
        // Azure Resources tree stays in sync when nodes expand, collapse or reconnect.
        this._refreshListenerDisposable = this._objectExplorerService.addRefreshListener((node) =>
            this._onDidChangeTreeData.fire(node ?? undefined),
        );
    }

    /**
     * Returns a lightweight placeholder for the SQL server resource.
     * No OE session is created here — that happens lazily in getChildren.
     */
    getResourceItem(resource: AzureResource): SqlServerRootModel {
        this._logger.info(`getResourceItem: ${resource.name} (${resource.id})`);
        return {
            id: resource.id,
            resource,
        };
    }

    /**
     * Returns the VS Code tree item for a model node.
     * Server roots are shown as collapsed (expandable). OE children use their own state.
     */
    getTreeItem(element: SqlBranchModel): vscode.TreeItem {
        if (isSqlServerRootModel(element)) {
            this._logger.info(`getTreeItem (root): ${element.resource.name}`);
            const item = new vscode.TreeItem(
                element.resource.name,
                vscode.TreeItemCollapsibleState.Collapsed,
            );
            item.id = element.id;
            item.contextValue = "azureResource;type=Server";
            item.tooltip = `${element.resource.name}.database.windows.net`;
            return item;
        } else {
            // OE child node (TreeNodeInfo)
            const item = new vscode.TreeItem(
                element.label ?? "",
                element.collapsibleState ?? vscode.TreeItemCollapsibleState.None,
            );
            item.id = element.id;
            item.iconPath = element.iconPath;
            item.contextValue = element.contextValue;
            item.tooltip = element.tooltip;
            item.description = element.description;
            item.command = element.command;
            return item;
        }
    }

    /**
     * Returns children for a model node.
     * - For a server root: creates the OE session on first call, then returns the root's children.
     * - For an OE child node: delegates to the OE expandNode call.
     */
    async getChildren(element: SqlBranchModel): Promise<SqlBranchModel[]> {
        if (isSqlServerRootModel(element)) {
            return this._getServerChildren(element);
        } else {
            return this._getOeChildren(element);
        }
    }

    private async _getServerChildren(element: SqlServerRootModel): Promise<SqlBranchModel[]> {
        const name = element.resource.name;
        this._logger.info(`getChildren (server root): ${name}`);

        try {
            // Lazily create the OE session on first expansion
            if (!element.sessionId || !element.connectionNode) {
                // Get the accountId/tenantId from the Azure Resources subscription context
                // so we know which account to use.
                const azSession =
                    await element.resource.subscription.authentication.getSessionWithScopes([
                        "https://database.windows.net/.default",
                    ]);

                if (!azSession) {
                    throw new Error(
                        `Could not acquire authentication for "${name}". ` +
                            `Ensure you are signed in with an account that has access to this server.`,
                    );
                }

                // Re-acquire the SQL token through MSSQL's own VS Code auth path.
                // This ensures MSSQL gets consent to the account and the token
                // refresh callback (from SQL Tools Service) will work correctly.
                this._logger.info(
                    `Creating OE session for ${name} (accountId: ${azSession.account.id}, tenantId: ${element.resource.subscription.tenantId})...`,
                );

                const tokenInfo = await acquireTokenFromVscodeAccountForResource(
                    getCloudResourceEndpoint("sqlResource"),
                    azSession.account.id,
                    element.resource.subscription.tenantId,
                    azSession.account.label,
                    { promptIfMissing: true },
                );

                const connectionInfo = buildConnectionInfo(element.resource, tokenInfo);

                const sessionResult =
                    await this._objectExplorerService.createSession(connectionInfo);

                if (!sessionResult?.connectionNode) {
                    throw new Error(
                        `Could not create an Object Explorer session for "${name}". ` +
                            `Check the server name and your permissions.`,
                    );
                }

                element.sessionId = sessionResult.sessionId;
                element.connectionNode = sessionResult.connectionNode;

                this._logger.info(
                    `OE session ready for ${name} (sessionId: ${sessionResult.sessionId})`,
                );
            }

            const children = await this._objectExplorerService.expandNode(
                element.connectionNode,
                element.sessionId,
            );

            this._logger.info(`${name} expanded: ${children?.length ?? 0} children`);
            return (children ?? []) as TreeNodeInfo[];
        } catch (err) {
            const msg = getErrorMessage(err);
            this._logger.error(`Error expanding "${name}": ${msg}`);
            throw err;
        }
    }

    private async _getOeChildren(element: TreeNodeInfo): Promise<SqlBranchModel[]> {
        if (!element.sessionId) {
            this._logger.info(`getChildren: no sessionId on "${element.label}" — returning empty`);
            return [];
        }
        this._logger.info(`Expanding OE node "${element.label}" (nodePath: ${element.nodePath})`);
        try {
            const children = await this._objectExplorerService.expandNode(
                element,
                element.sessionId,
            );
            return (children ?? []) as TreeNodeInfo[];
        } catch (err) {
            const msg = getErrorMessage(err);
            this._logger.error(`Error expanding "${element.label}": ${msg}`);
            return [];
        }
    }

    dispose(): void {
        this._refreshListenerDisposable.dispose();
        this._onDidChangeTreeData.dispose();
    }
}

/**
 * Builds an IConnectionInfo for Azure SQL using a token acquired via MSSQL's
 * VS Code auth path (`acquireTokenFromVscodeAccountForResource`).
 */
function buildConnectionInfo(
    resource: AzureResource,
    tokenInfo: {
        account: { id: string; label: string };
        tenantId: string;
        token: { token: string; expiresOn?: number };
    },
): IConnectionInfo {
    return {
        server: `${resource.name}.database.windows.net`,
        database: "",
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
}
