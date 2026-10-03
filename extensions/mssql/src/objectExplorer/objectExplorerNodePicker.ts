/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { IConnectionInfo } from "vscode-mssql";
import ConnectionManager from "../controllers/connectionManager";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { ObjectExplorerProvider } from "./objectExplorerProvider";
import { TreeNodeInfo } from "./nodes/treeNodeInfo";

/**
 * The kinds of Object Explorer node a command can run against.
 */
export enum ObjectExplorerTarget {
    Server = "Server",
    Database = "Database",
    Table = "Table",
}

/**
 * The parts of MainController the picker depends on.
 */
export interface ObjectExplorerNodePickerHost {
    readonly connectionManager: ConnectionManager;
    readonly objectExplorerProvider: ObjectExplorerProvider;
    readonly objectExplorerTree: vscode.TreeView<TreeNodeInfo> | undefined;
    createObjectExplorerSession(connectionInfo: IConnectionInfo): Promise<TreeNodeInfo | undefined>;
}

interface NodeQuickPickItem extends vscode.QuickPickItem {
    node: TreeNodeInfo;
}

const tableNodeType = "Table";
const schemaNodeType = "Schema";
const tablesFolderSubType = "Tables";

/**
 * Resolves the Object Explorer node a command should run against.
 *
 * Commands launched from the Object Explorer context menu receive the clicked node. Commands
 * launched from the Command Palette or a keybinding receive nothing, so the picker falls back to
 * the Object Explorer selection, and then prompts the user to choose the server, database or
 * table the command needs.
 */
export class ObjectExplorerNodePicker {
    constructor(private _host: ObjectExplorerNodePickerHost) {}

    /**
     * @param node The node passed to the command, if any
     * @param targets The node kinds the command accepts, matching its context menu `when` clause
     * @returns The node to run the command against, or undefined if the user cancelled
     */
    public async resolveNode(
        node: TreeNodeInfo | undefined,
        targets: ObjectExplorerTarget[],
    ): Promise<TreeNodeInfo | undefined> {
        if (node) {
            return node;
        }

        const selection = this._host.objectExplorerTree?.selection;
        const selectedNode = selection?.length === 1 ? selection[0] : undefined;

        // A selected node, or the database or server it belongs to, can be used directly.
        const selectedTarget = findMatchingNode(selectedNode, targets);
        if (selectedTarget) {
            return selectedTarget;
        }

        // A table command run with a database selected lists that database's tables.
        const selectedDatabase = findMatchingNode(selectedNode, [ObjectExplorerTarget.Database]);
        if (selectedDatabase && targets.includes(ObjectExplorerTarget.Table)) {
            return this.pickTable(selectedDatabase);
        }

        const serverNode = await this.resolveServerNode(selectedNode);
        if (!serverNode) {
            return undefined;
        }
        return this.pickFromServer(serverNode, targets);
    }

    /**
     * Gets a connected server node, reusing the server of the selected node when there is one
     * and otherwise prompting the user to choose a connection.
     */
    private async resolveServerNode(
        selectedNode?: TreeNodeInfo,
    ): Promise<TreeNodeInfo | undefined> {
        const selectedServer = findConnectionNode(selectedNode);
        if (selectedServer?.nodeType === Constants.serverLabel) {
            return selectedServer;
        }

        const connectionInfo =
            selectedServer?.connectionProfile ?? (await this.promptForConnection());
        if (!connectionInfo) {
            return undefined;
        }
        return this._host.createObjectExplorerSession(connectionInfo);
    }

    private async promptForConnection(): Promise<IConnectionInfo | undefined> {
        const connectionManager = this._host.connectionManager;
        const connectionProfiles = await connectionManager.connectionStore.getPickListItems();
        return connectionManager.connectionUI.promptForConnection(connectionProfiles);
    }

    private async pickFromServer(
        serverNode: TreeNodeInfo,
        targets: ObjectExplorerTarget[],
    ): Promise<TreeNodeInfo | undefined> {
        if (matchesTarget(serverNode, targets)) {
            return serverNode;
        }

        // A connection scoped to one database has no Databases folder; its server node is the
        // database.
        const databaseNode = isDatabaseScopedServerNode(serverNode)
            ? serverNode
            : await this.pickDatabase(serverNode);
        if (!databaseNode || targets.includes(ObjectExplorerTarget.Database)) {
            return databaseNode;
        }
        return this.pickTable(databaseNode);
    }

    private async pickDatabase(serverNode: TreeNodeInfo): Promise<TreeNodeInfo | undefined> {
        const databases = await this.loadNodes(async () => {
            const serverChildren = await this.getChildren(serverNode);
            const databasesFolder = serverChildren.find(
                (child) =>
                    child.context.type === Constants.folderLabel &&
                    child.context.subType === Constants.databasesSubNodeType,
            );
            if (!databasesFolder) {
                return [];
            }

            const folderChildren = await this.getChildren(databasesFolder);
            const result = folderChildren.filter(isDatabaseNode);
            // System databases are grouped in a subfolder.
            for (const subFolder of folderChildren.filter(
                (child) => child.context.type === Constants.folderLabel,
            )) {
                result.push(...(await this.getChildren(subFolder)).filter(isDatabaseNode));
            }
            return result;
        });

        return this.pickNode(
            databases,
            LocalizedConstants.ObjectExplorer.SelectDatabasePlaceholder,
            LocalizedConstants.ObjectExplorer.NoDatabasesFound(
                serverNode.connectionProfile?.server ?? getLabel(serverNode),
            ),
        );
    }

    private async pickTable(databaseNode: TreeNodeInfo): Promise<TreeNodeInfo | undefined> {
        const databaseChildren = await this.loadNodes(() => this.getChildren(databaseNode));

        // When Object Explorer groups objects by schema, the Tables folder is under each schema.
        let tablesParent = databaseNode;
        let tablesFolder = databaseChildren.find(isTablesFolderNode);
        if (!tablesFolder) {
            const schemaNode = await this.pickNode(
                databaseChildren.filter((child) => child.context.type === schemaNodeType),
                LocalizedConstants.ObjectExplorer.SelectSchemaPlaceholder,
                LocalizedConstants.ObjectExplorer.NoTablesFound(getLabel(databaseNode)),
            );
            if (!schemaNode) {
                return undefined;
            }
            tablesParent = schemaNode;
            tablesFolder = (await this.loadNodes(() => this.getChildren(schemaNode))).find(
                isTablesFolderNode,
            );
        }

        const tables = tablesFolder
            ? (await this.loadNodes(() => this.getChildren(tablesFolder))).filter(
                  (child) => child.context.type === tableNodeType,
              )
            : [];
        return this.pickNode(
            tables,
            LocalizedConstants.ObjectExplorer.SelectTablePlaceholder,
            LocalizedConstants.ObjectExplorer.NoTablesFound(getLabel(tablesParent)),
        );
    }

    private getChildren(node: TreeNodeInfo): Promise<TreeNodeInfo[]> {
        return this._host.objectExplorerProvider.getLoadedNodeChildren(node);
    }

    private loadNodes(load: () => Promise<TreeNodeInfo[]>): Thenable<TreeNodeInfo[]> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: LocalizedConstants.ObjectExplorer.LoadingNodeLabel,
            },
            load,
        );
    }

    private async pickNode(
        nodes: TreeNodeInfo[],
        placeHolder: string,
        noNodesMessage: string,
    ): Promise<TreeNodeInfo | undefined> {
        if (nodes.length === 0) {
            void vscode.window.showErrorMessage(noNodesMessage);
            return undefined;
        }

        const items: NodeQuickPickItem[] = nodes.map((node) => ({
            label: getLabel(node),
            node,
        }));
        const selected = await vscode.window.showQuickPick(items, { placeHolder });
        return selected?.node;
    }
}

function getLabel(node: TreeNodeInfo): string {
    return typeof node.label === "string" ? node.label : (node.label?.label ?? "");
}

function isDatabaseScopedServerNode(node: TreeNodeInfo): boolean {
    return (
        node.context.type === Constants.serverLabel &&
        (node.context.subType === Constants.databaseString ||
            node.context.subType === Constants.dockerContainerDatabase)
    );
}

function isDatabaseNode(node: TreeNodeInfo): boolean {
    return node.context.type === Constants.databaseString;
}

function isTablesFolderNode(node: TreeNodeInfo): boolean {
    return (
        node.context.type === Constants.folderLabel && node.context.subType === tablesFolderSubType
    );
}

function matchesTarget(node: TreeNodeInfo, targets: ObjectExplorerTarget[]): boolean {
    return targets.some((target) => {
        switch (target) {
            case ObjectExplorerTarget.Server:
                return node.context.type === Constants.serverLabel;
            case ObjectExplorerTarget.Database:
                return isDatabaseNode(node) || isDatabaseScopedServerNode(node);
            case ObjectExplorerTarget.Table:
                return node.context.type === tableNodeType;
            default:
                return false;
        }
    });
}

/**
 * Finds the closest node, starting from the given node and walking up its parents, that matches
 * one of the targets. Database targets are checked before server targets, so a node inside a
 * database resolves to that database rather than its server.
 */
function findMatchingNode(
    node: TreeNodeInfo | undefined,
    targets: ObjectExplorerTarget[],
): TreeNodeInfo | undefined {
    for (let current = node; current; current = current.parentNode) {
        if (matchesTarget(current, targets)) {
            return current;
        }
    }
    return undefined;
}

/**
 * Finds the connected or disconnected server node that the given node belongs to.
 */
function findConnectionNode(node: TreeNodeInfo | undefined): TreeNodeInfo | undefined {
    for (let current = node; current; current = current.parentNode) {
        if (
            current.nodeType === Constants.serverLabel ||
            current.nodeType === Constants.disconnectedServerNodeType
        ) {
            return current;
        }
    }
    return undefined;
}
