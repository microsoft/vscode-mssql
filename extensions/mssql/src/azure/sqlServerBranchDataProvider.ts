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
        private readonly _outputChannel: vscode.OutputChannel,
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
        this._outputChannel.appendLine(
            `[Azure Resources] getResourceItem: ${resource.name} (${resource.id})`,
        );
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
            this._outputChannel.appendLine(
                `[Azure Resources] getTreeItem (root): ${element.resource.name}`,
            );
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
        this._outputChannel.appendLine(`[Azure Resources] getChildren (server root): ${name}`);

        try {
            // Lazily create the OE session on first expansion
            if (!element.sessionId || !element.connectionNode) {
                const session =
                    await element.resource.subscription.authentication.getSessionWithScopes([
                        "https://database.windows.net/.default",
                    ]);

                if (!session) {
                    throw new Error(
                        `Could not acquire authentication for "${name}". ` +
                            `Ensure you are signed in with an account that has access to this server.`,
                    );
                }

                const connectionInfo = buildConnectionInfo(element.resource, session.accessToken);

                this._outputChannel.appendLine(
                    `[Azure Resources] Creating OE session for ${name}...`,
                );

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

                this._outputChannel.appendLine(
                    `[Azure Resources] OE session ready for ${name} (sessionId: ${sessionResult.sessionId})`,
                );
            }

            const children = await this._objectExplorerService.expandNode(
                element.connectionNode,
                element.sessionId,
            );

            this._outputChannel.appendLine(
                `[Azure Resources] ${name} expanded: ${children?.length ?? 0} children`,
            );
            return (children ?? []) as TreeNodeInfo[];
        } catch (err) {
            const msg = getErrorMessage(err);
            this._outputChannel.appendLine(`[Azure Resources] Error expanding "${name}": ${msg}`);
            throw err;
        }
    }

    private async _getOeChildren(element: TreeNodeInfo): Promise<SqlBranchModel[]> {
        if (!element.sessionId) {
            this._outputChannel.appendLine(
                `[Azure Resources] getChildren: no sessionId on "${element.label}" — returning empty`,
            );
            return [];
        }
        this._outputChannel.appendLine(
            `[Azure Resources] Expanding OE node "${element.label}" (nodePath: ${element.nodePath})`,
        );
        try {
            const children = await this._objectExplorerService.expandNode(
                element,
                element.sessionId,
            );
            return (children ?? []) as TreeNodeInfo[];
        } catch (err) {
            const msg = getErrorMessage(err);
            this._outputChannel.appendLine(
                `[Azure Resources] Error expanding "${element.label}": ${msg}`,
            );
            return [];
        }
    }

    dispose(): void {
        this._refreshListenerDisposable.dispose();
        this._onDidChangeTreeData.dispose();
    }
}

/**
 * Builds an IConnectionInfo for Azure SQL using a pre-acquired Entra token.
 */
function buildConnectionInfo(resource: AzureResource, accessToken: string): IConnectionInfo {
    return {
        server: `${resource.name}.database.windows.net`,
        database: "",
        user: "",
        password: "",
        email: resource.subscription.account?.label,
        accountId: resource.subscription.account?.id,
        tenantId: resource.subscription.tenantId,
        port: 0,
        authenticationType: "AzureMFA",
        azureAccountToken: accessToken,
        expiresOn: parseTokenExpiry(accessToken),
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

/**
 * Parses the `exp` claim from a JWT access token and returns it as a Unix timestamp (seconds).
 * Returns undefined if the token cannot be parsed.
 */
function parseTokenExpiry(accessToken: string): number | undefined {
    try {
        const parts = accessToken.split(".");
        if (parts.length < 2) {
            return undefined;
        }
        const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const payload = Buffer.from(padded, "base64").toString("utf8");
        const claims = JSON.parse(payload) as Record<string, unknown>;
        return typeof claims["exp"] === "number" ? claims["exp"] : undefined;
    } catch {
        return undefined;
    }
}
