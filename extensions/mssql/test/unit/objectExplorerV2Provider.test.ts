/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { OverviewTreeNode } from "../../src/objectExplorer/nodes/overviewTreeNode";
import { ObjectExplorerV2Provider } from "../../src/objectExplorer/v2/objectExplorerV2Provider";
import { OeV2TreeController } from "../../src/objectExplorer/v2/tree/oeV2TreeController";
import { initializeIconUtils } from "./utils";

chai.use(sinonChai);
const expect = chai.expect;

suite("Object Explorer v2 view parity", () => {
    const sandbox = sinon.createSandbox();
    let controller: OeV2TreeController;
    let provider: ObjectExplorerV2Provider;
    let visibilityChanged: vscode.EventEmitter<boolean>;
    let overviewVisible: boolean;

    setup(() => {
        initializeIconUtils();
        overviewVisible = true;
        visibilityChanged = new vscode.EventEmitter<boolean>();
        controller = new OeV2TreeController({
            profiles: {
                readAllConnectionGroups: async () => [
                    { id: "ROOT", name: "ROOT" },
                    { id: "team", name: "Team", parentId: "ROOT" },
                    { id: "nested", name: "Nested", parentId: "team" },
                ],
                readAllConnections: async () => [
                    { id: "server", server: "localhost", groupId: "nested" },
                ],
            },
            dataPlane: { enabled: () => true, availabilityState: () => "available" },
        });
        provider = new ObjectExplorerV2Provider(controller, {
            isVisible: () => overviewVisible,
            onDidChange: visibilityChanged.event,
        });
    });

    teardown(() => {
        provider.dispose();
        controller.dispose();
        visibilityChanged.dispose();
        sandbox.restore();
    });

    test("Getting Started leads the tree and opens the same page as classic OE", async () => {
        const roots = await provider.getChildren();
        expect(roots.map((node) => node.kind)).to.deep.equal(["overview", "connectionGroup"]);
        const item = provider.getTreeItem(roots[0]);
        const classic = new OverviewTreeNode();
        for (const property of [
            "label",
            "description",
            "tooltip",
            "iconPath",
            "command",
            "contextValue",
            "collapsibleState",
        ] as const) {
            expect(item[property], property).to.deep.equal(classic[property]);
        }
        expect(await provider.getChildren(roots[0])).to.deep.equal([]);
        expect((await provider.getChildren(roots[1])).map((node) => node.kind)).to.deep.equal([
            "connectionGroup",
        ]);
        expect((await provider.getChildren())[0].id).to.equal(item.id);
    });

    test("shared hide/show preference refreshes the root without invalidating connections", async () => {
        const changed = sandbox.spy();
        const refresh = sandbox.spy(controller, "refresh");
        provider.onDidChangeTreeData(changed);
        overviewVisible = false;
        visibilityChanged.fire(false);
        expect(changed).to.have.been.calledWithExactly(undefined);
        expect((await provider.getChildren()).map((node) => node.kind)).to.deep.equal([
            "connectionGroup",
        ]);
        overviewVisible = true;
        visibilityChanged.fire(true);
        expect((await provider.getChildren())[0].kind).to.equal("overview");
        expect(refresh).not.to.have.been.called;
    });

    test("groups start expanded at every depth while saved connections stay collapsed", async () => {
        const connect = sandbox.spy(controller, "connectProfile");
        const group = (await provider.getChildren())[1];
        const [nested] = await provider.getChildren(group);
        const [connection] = await provider.getChildren(nested);
        for (const node of [group, nested]) {
            expect(provider.getTreeItem(node).collapsibleState).to.equal(
                vscode.TreeItemCollapsibleState.Expanded,
            );
        }
        expect(provider.getTreeItem(connection).collapsibleState).to.equal(
            vscode.TreeItemCollapsibleState.Collapsed,
        );
        expect(connect).not.to.have.been.called;
    });

    test("honors the existing preference to collapse groups on startup", async () => {
        sandbox
            .stub(vscode.workspace, "getConfiguration")
            .withArgs("mssql")
            .returns({
                get: sandbox
                    .stub()
                    .withArgs("objectExplorer.collapseConnectionGroupsOnStartup", false)
                    .returns(true),
            } as unknown as vscode.WorkspaceConfiguration);
        provider.dispose();
        provider = new ObjectExplorerV2Provider(controller);
        const group = (await provider.getChildren())[1];
        const [nested] = await provider.getChildren(group);
        for (const node of [group, nested]) {
            expect(provider.getTreeItem(node).collapsibleState).to.equal(
                vscode.TreeItemCollapsibleState.Collapsed,
            );
        }
    });
});
