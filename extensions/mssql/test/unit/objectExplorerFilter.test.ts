/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import { ObjectExplorerFilter } from "../../src/objectExplorer/objectExplorerFilter";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { initializeIconUtils } from "./utils";
import { IConnectionProfile } from "../../src/models/interfaces";

suite("ObjectExplorerFilter", () => {
    setup(() => {
        initializeIconUtils();
    });

    test("getBreadcrumbSegments returns labels from root to leaf", () => {
        const serverNode = createTreeNode("localhost", "Server");
        const databasesNode = createTreeNode("Databases", "Folder", serverNode);
        const databaseNode = createTreeNode("AdventureWorks2022", "Database", databasesNode);
        const tablesNode = createTreeNode("Tables", "Folder", databaseNode);

        const segments = (ObjectExplorerFilter as any).getBreadcrumbSegments(tablesNode);

        expect(segments).to.deep.equal(["localhost", "Databases", "AdventureWorks2022", "Tables"]);
    });

    test("getBreadcrumbSegments uses original labels instead of filtered labels", () => {
        const serverNode = createTreeNode("localhost", "Server");
        const tablesNode = createTreeNode("Tables", "Folder", serverNode);

        tablesNode.filters = [{ name: "name", value: "dbo", operator: 8 } as any];

        expect(tablesNode.label?.toString()).to.equal("Tables (filtered)");

        const segments = (ObjectExplorerFilter as any).getBreadcrumbSegments(tablesNode);

        expect(segments).to.deep.equal(["localhost", "Tables"]);
    });
});

function createTreeNode(label: string, nodeType: string, parentNode?: TreeNodeInfo): TreeNodeInfo {
    const profile: IConnectionProfile = {
        id: "test-profile-id",
        server: "localhost",
        database: "master",
    } as IConnectionProfile;

    return new TreeNodeInfo(
        label,
        { type: nodeType, filterable: false, hasFilters: false, subType: undefined },
        vscode.TreeItemCollapsibleState.None,
        `${label}-path`,
        "ready",
        nodeType,
        "test-session",
        profile,
        parentNode as TreeNodeInfo,
        [],
        undefined,
        undefined,
        undefined,
    );
}
