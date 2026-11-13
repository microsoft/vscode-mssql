/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import { ConnectionGroupExpansionStateStore } from "../../src/objectExplorer/connectionGroupExpansionStateStore";
import { ConnectionGroupNode } from "../../src/objectExplorer/nodes/connectionGroupNode";
import { createInMemoryMemento } from "./utils";

suite("ConnectionGroupExpansionStateStore", () => {
    let store: ConnectionGroupExpansionStateStore;

    setup(() => {
        store = new ConnectionGroupExpansionStateStore(createInMemoryMemento());
    });

    test("returns undefined for groups without recorded state", () => {
        expect(store.isExpanded("group1")).to.be.undefined;
    });

    test("records expanded and collapsed state per group", async () => {
        await store.setExpanded("group1", false);
        await store.setExpanded("group2", true);

        expect(store.isExpanded("group1")).to.equal(false);
        expect(store.isExpanded("group2")).to.equal(true);
    });

    test("remove clears state only for the specified groups", async () => {
        await store.setExpanded("group1", false);
        await store.setExpanded("group2", false);
        await store.setExpanded("group3", true);

        await store.remove(["group1", "group2", "unknownGroup"]);

        expect(store.isExpanded("group1")).to.be.undefined;
        expect(store.isExpanded("group2")).to.be.undefined;
        expect(store.isExpanded("group3")).to.equal(true);
    });

    suite("trackTreeView", () => {
        let onDidExpand: vscode.EventEmitter<vscode.TreeViewExpansionEvent<unknown>>;
        let onDidCollapse: vscode.EventEmitter<vscode.TreeViewExpansionEvent<unknown>>;
        let tracking: vscode.Disposable;

        setup(() => {
            onDidExpand = new vscode.EventEmitter();
            onDidCollapse = new vscode.EventEmitter();
            // TreeView is an interface; only the expansion events are needed here.
            const treeView = {
                onDidExpandElement: onDidExpand.event,
                onDidCollapseElement: onDidCollapse.event,
            } as vscode.TreeView<unknown>;
            tracking = store.trackTreeView(treeView);
        });

        teardown(() => {
            tracking.dispose();
            onDidExpand.dispose();
            onDidCollapse.dispose();
        });

        test("records expand and collapse events for connection group nodes", async () => {
            const group = new ConnectionGroupNode({
                id: "group1",
                name: "Group 1",
                configSource: vscode.ConfigurationTarget.Global,
            });

            onDidCollapse.fire({ element: group });
            await Promise.resolve();
            expect(store.isExpanded("group1")).to.equal(false);

            onDidExpand.fire({ element: group });
            await Promise.resolve();
            expect(store.isExpanded("group1")).to.equal(true);
        });

        test("ignores expansion events for other node types", async () => {
            const node = new vscode.TreeItem("Tables");
            node.id = "group1";

            onDidCollapse.fire({ element: node });
            await Promise.resolve();

            expect(store.isExpanded("group1")).to.be.undefined;
        });
    });
});
