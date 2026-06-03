/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import {
    ConnectionGroupNode,
    compareOrderedNodes,
} from "../../src/objectExplorer/nodes/connectionGroupNode";
import { ConnectionNode } from "../../src/objectExplorer/nodes/connectionNode";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { IConnectionGroup, IConnectionProfile } from "../../src/models/interfaces";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import { initializeIconUtils } from "./utils";

function makeGroup(name: string, order?: number, id?: string): IConnectionGroup {
    return {
        id: id ?? `group_${name}`,
        name,
        parentId: ConnectionConfig.ROOT_GROUP_ID,
        configSource: vscode.ConfigurationTarget.Global,
        order,
    };
}

function makeGroupNode(name: string, order?: number, id?: string): ConnectionGroupNode {
    return new ConnectionGroupNode(makeGroup(name, order, id));
}

function makeProfile(name: string, order?: number, id?: string): IConnectionProfile {
    return {
        profileName: name,
        id: id ?? `conn_${name}`,
        server: name,
        database: "",
        authenticationType: "SqlLogin",
        user: "",
        password: "",
        savePassword: false,
        groupId: ConnectionConfig.ROOT_GROUP_ID,
        order,
        // The rest of IConnectionProfile is irrelevant for ordering tests.
    } as unknown as IConnectionProfile;
}

function makeConnectionNode(name: string, order?: number, id?: string): ConnectionNode {
    return new ConnectionNode(makeProfile(name, order, id) as never);
}

function makeRootGroupNode(): ConnectionGroupNode {
    return new ConnectionGroupNode({
        id: ConnectionConfig.ROOT_GROUP_ID,
        name: ConnectionConfig.ROOT_GROUP_ID,
        configSource: vscode.ConfigurationTarget.Global,
    });
}

function labels(nodes: TreeNodeInfo[]): string[] {
    return nodes.map((n) => n.label.toString());
}

suite("ConnectionGroupNode ordering", () => {
    setup(() => {
        initializeIconUtils();
    });

    suite("addChild — groups", () => {
        test("Groups without `order` are sorted alphabetically (case-insensitive)", () => {
            const parent = makeRootGroupNode();
            parent.addChild(makeGroupNode("bravo"));
            parent.addChild(makeGroupNode("Alpha"));
            parent.addChild(makeGroupNode("charlie"));

            expect(labels(parent.children)).to.deep.equal(["Alpha", "bravo", "charlie"]);
        });

        test("Groups with `order` come before unordered groups, lowest first", () => {
            const parent = makeRootGroupNode();
            parent.addChild(makeGroupNode("zeta")); // unordered
            parent.addChild(makeGroupNode("alpha", 5));
            parent.addChild(makeGroupNode("bravo", 1));
            parent.addChild(makeGroupNode("delta")); // unordered
            parent.addChild(makeGroupNode("charlie", 0));

            expect(labels(parent.children)).to.deep.equal([
                "charlie", // order 0
                "bravo", // order 1
                "alpha", // order 5
                "delta", // unordered, alphabetical
                "zeta", // unordered, alphabetical
            ]);
        });

        test("Ties on `order` are broken alphabetically (case-insensitive)", () => {
            const parent = makeRootGroupNode();
            parent.addChild(makeGroupNode("Charlie", 2));
            parent.addChild(makeGroupNode("alpha", 2));
            parent.addChild(makeGroupNode("Bravo", 2));

            expect(labels(parent.children)).to.deep.equal(["alpha", "Bravo", "Charlie"]);
        });

        test("Negative / non-numeric `order` values are ignored (treated as unordered)", () => {
            const parent = makeRootGroupNode();
            parent.addChild(makeGroupNode("alpha", -1));
            parent.addChild(makeGroupNode("bravo", Number.NaN));
            parent.addChild(makeGroupNode("charlie", 0));
            parent.addChild(makeGroupNode("delta", 3));

            expect(labels(parent.children)).to.deep.equal([
                "charlie", // order 0
                "delta", // order 3
                "alpha", // negative -> treated as unordered
                "bravo", // NaN -> treated as unordered
            ]);
        });
    });

    suite("addChild — connections", () => {
        test("Connections obey the same ordering rules as groups", () => {
            const parent = makeRootGroupNode();
            parent.addChild(makeConnectionNode("server-z"));
            parent.addChild(makeConnectionNode("server-a", 10));
            parent.addChild(makeConnectionNode("server-b", 0));
            parent.addChild(makeConnectionNode("Server-M"));

            expect(labels(parent.children)).to.deep.equal([
                "server-b", // order 0
                "server-a", // order 10
                "Server-M", // unordered
                "server-z", // unordered
            ]);
        });
    });

    suite("addChild — mixed children", () => {
        test("Groups always render before connections regardless of `order`", () => {
            const parent = makeRootGroupNode();

            // Ordered connection mixed with unordered group
            parent.addChild(makeConnectionNode("conn-a", 0));
            parent.addChild(makeGroupNode("zeta-group"));
            parent.addChild(makeGroupNode("alpha-group", 100));
            parent.addChild(makeConnectionNode("conn-b"));

            const result = labels(parent.children);

            // Groups first, in their own order (ordered group first, then unordered)
            expect(result.slice(0, 2)).to.deep.equal(["alpha-group", "zeta-group"]);
            // Connections after, in their own order (ordered connection first, then unordered)
            expect(result.slice(2)).to.deep.equal(["conn-a", "conn-b"]);
        });
    });

    suite("compareOrderedNodes", () => {
        test("Returns negative when a has order and b does not", () => {
            const a = makeGroupNode("z", 0);
            const b = makeGroupNode("a");
            expect(compareOrderedNodes(a, b)).to.be.lessThan(0);
            expect(compareOrderedNodes(b, a)).to.be.greaterThan(0);
        });

        test("Falls back to alphabetical (lower-cased) comparison", () => {
            const a = makeGroupNode("Banana");
            const b = makeGroupNode("apple");
            expect(compareOrderedNodes(a, b)).to.be.greaterThan(0);
            expect(compareOrderedNodes(b, a)).to.be.lessThan(0);
        });
    });
});
