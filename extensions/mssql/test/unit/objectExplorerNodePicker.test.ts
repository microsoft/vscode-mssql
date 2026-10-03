/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";

import ConnectionManager from "../../src/controllers/connectionManager";
import { ConnectionStore } from "../../src/models/connectionStore";
import { ConnectionUI } from "../../src/views/connectionUI";
import { IConnectionProfile } from "../../src/models/interfaces";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { ObjectExplorerProvider } from "../../src/objectExplorer/objectExplorerProvider";
import {
    ObjectExplorerNodePicker,
    ObjectExplorerNodePickerHost,
    ObjectExplorerTarget,
} from "../../src/objectExplorer/objectExplorerNodePicker";
import * as Constants from "../../src/constants/constants";
import * as LocalizedConstants from "../../src/constants/locConstants";
import { initializeIconUtils, stubVscodeWindow, stubWithProgress } from "./utils";

chai.use(sinonChai);

suite("ObjectExplorerNodePicker", () => {
    let sandbox: sinon.SinonSandbox;
    let window: ReturnType<typeof stubVscodeWindow>;
    let connectionUi: sinon.SinonStubbedInstance<ConnectionUI>;
    let provider: sinon.SinonStubbedInstance<ObjectExplorerProvider>;
    let createSession: sinon.SinonStub;
    let selection: TreeNodeInfo[];
    let picker: ObjectExplorerNodePicker;

    const profile = { id: "conn1", server: "localhost" } as IConnectionProfile;

    function createNode(
        label: string,
        type: string,
        options: { subType?: string; parent?: TreeNodeInfo; profile?: IConnectionProfile } = {},
    ): TreeNodeInfo {
        return new TreeNodeInfo(
            label,
            { type, subType: options.subType, filterable: false, hasFilters: false },
            vscode.TreeItemCollapsibleState.Collapsed,
            `${label}_path`,
            undefined,
            type,
            "session1",
            options.profile ?? options.parent?.connectionProfile ?? profile,
            options.parent,
            undefined,
            undefined,
        );
    }

    function stubChildren(parent: TreeNodeInfo, children: TreeNodeInfo[]): void {
        provider.getLoadedNodeChildren.withArgs(parent).resolves(children);
    }

    function pickByLabel(label: string): void {
        window.showQuickPick.callsFake(async (items: vscode.QuickPickItem[]) =>
            items.find((item) => item.label === label),
        );
    }

    function pickedLabels(): string[] {
        const items = window.showQuickPick.lastCall.args[0] as vscode.QuickPickItem[];
        return items.map((item) => item.label);
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        initializeIconUtils();
        window = stubVscodeWindow(sandbox);
        stubWithProgress(sandbox, (_options, task) =>
            task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
        );

        const connectionManager = sandbox.createStubInstance(ConnectionManager);
        const connectionStore = sandbox.createStubInstance(ConnectionStore);
        connectionUi = sandbox.createStubInstance(ConnectionUI);
        sandbox.stub(connectionManager, "connectionStore").get(() => connectionStore);
        sandbox.stub(connectionManager, "connectionUI").get(() => connectionUi);
        connectionStore.getPickListItems.resolves([]);
        connectionUi.promptForConnection.resolves(profile);

        provider = sandbox.createStubInstance(ObjectExplorerProvider);
        provider.getLoadedNodeChildren.resolves([]);
        createSession = sandbox.stub();
        selection = [];

        const host: ObjectExplorerNodePickerHost = {
            connectionManager,
            objectExplorerProvider: provider,
            objectExplorerTree: { selection } as unknown as vscode.TreeView<TreeNodeInfo>,
            createObjectExplorerSession: createSession,
        };
        picker = new ObjectExplorerNodePicker(host);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("returns the node passed by the context menu without prompting", async () => {
        const node = createNode("server", Constants.serverLabel);

        const result = await picker.resolveNode(node, [ObjectExplorerTarget.Database]);

        expect(result).to.equal(node);
        expect(connectionUi.promptForConnection).to.not.have.been.called;
    });

    test("uses the database that contains the selected node", async () => {
        const server = createNode("server", Constants.serverLabel);
        const database = createNode("sales", Constants.databaseString, { parent: server });
        selection.push(createNode("dbo.Orders", "Table", { parent: database }));

        const result = await picker.resolveNode(undefined, [ObjectExplorerTarget.Database]);

        expect(result).to.equal(database);
        expect(connectionUi.promptForConnection).to.not.have.been.called;
    });

    test("prompts for a connection and returns its server node", async () => {
        const server = createNode("server", Constants.serverLabel);
        createSession.resolves(server);

        const result = await picker.resolveNode(undefined, [ObjectExplorerTarget.Server]);

        expect(connectionUi.promptForConnection).to.have.been.called;
        expect(createSession).to.have.been.calledWith(profile);
        expect(result).to.equal(server);
    });

    test("returns undefined without connecting when the connection prompt is cancelled", async () => {
        connectionUi.promptForConnection.resolves(undefined);

        const result = await picker.resolveNode(undefined, [ObjectExplorerTarget.Server]);

        expect(result).to.be.undefined;
        expect(createSession).to.not.have.been.called;
    });

    test("lists user and system databases after a connection is chosen", async () => {
        const server = createNode("server", Constants.serverLabel);
        const databasesFolder = createNode("Databases", Constants.folderLabel, {
            subType: Constants.databasesSubNodeType,
            parent: server,
        });
        const systemFolder = createNode("System Databases", Constants.folderLabel, {
            parent: databasesFolder,
        });
        const sales = createNode("sales", Constants.databaseString, { parent: databasesFolder });
        const master = createNode("master", Constants.databaseString, { parent: systemFolder });
        createSession.resolves(server);
        stubChildren(server, [databasesFolder]);
        stubChildren(databasesFolder, [systemFolder, sales]);
        stubChildren(systemFolder, [master]);
        pickByLabel("sales");

        const result = await picker.resolveNode(undefined, [ObjectExplorerTarget.Database]);

        expect(pickedLabels()).to.have.members(["sales", "master"]);
        expect(result).to.equal(sales);
    });

    test("lists the databases of the selected server without prompting for a connection", async () => {
        const server = createNode("server", Constants.serverLabel);
        const databasesFolder = createNode("Databases", Constants.folderLabel, {
            subType: Constants.databasesSubNodeType,
            parent: server,
        });
        const sales = createNode("sales", Constants.databaseString, { parent: databasesFolder });
        selection.push(server);
        stubChildren(server, [databasesFolder]);
        stubChildren(databasesFolder, [sales]);
        pickByLabel("sales");

        const result = await picker.resolveNode(undefined, [ObjectExplorerTarget.Database]);

        expect(connectionUi.promptForConnection).to.not.have.been.called;
        expect(result).to.equal(sales);
    });

    test("connects the selected disconnected server instead of prompting", async () => {
        const disconnected = createNode("server", Constants.disconnectedServerNodeType);
        const server = createNode("server", Constants.serverLabel);
        selection.push(disconnected);
        createSession.resolves(server);

        const result = await picker.resolveNode(undefined, [ObjectExplorerTarget.Server]);

        expect(connectionUi.promptForConnection).to.not.have.been.called;
        expect(createSession).to.have.been.calledWith(disconnected.connectionProfile);
        expect(result).to.equal(server);
    });

    test("returns the server node of a database-scoped connection as the database", async () => {
        const server = createNode("sales", Constants.serverLabel, {
            subType: Constants.databaseString,
        });
        createSession.resolves(server);

        const result = await picker.resolveNode(undefined, [ObjectExplorerTarget.Database]);

        expect(result).to.equal(server);
        expect(window.showQuickPick).to.not.have.been.called;
    });

    test("shows an error when the server has no databases", async () => {
        const server = createNode("server", Constants.serverLabel);
        createSession.resolves(server);

        const result = await picker.resolveNode(undefined, [ObjectExplorerTarget.Database]);

        expect(result).to.be.undefined;
        expect(window.showErrorMessage).to.have.been.calledWith(
            LocalizedConstants.ObjectExplorer.NoDatabasesFound("localhost"),
        );
    });

    test("lists the tables of the selected database, asking for a schema when objects are grouped by schema", async () => {
        const server = createNode("server", Constants.serverLabel);
        const database = createNode("sales", Constants.databaseString, { parent: server });
        const schema = createNode("dbo", "Schema", { parent: database });
        const tablesFolder = createNode("Tables", Constants.folderLabel, {
            subType: "Tables",
            parent: schema,
        });
        const orders = createNode("dbo.Orders", "Table", { parent: tablesFolder });
        selection.push(database);
        stubChildren(database, [schema]);
        stubChildren(schema, [tablesFolder]);
        stubChildren(tablesFolder, [orders]);
        const offeredLabels: string[][] = [];
        window.showQuickPick.callsFake(async (items: vscode.QuickPickItem[]) => {
            offeredLabels.push(items.map((item) => item.label));
            return items[0];
        });

        const result = await picker.resolveNode(undefined, [ObjectExplorerTarget.Table]);

        expect(connectionUi.promptForConnection).to.not.have.been.called;
        expect(offeredLabels).to.deep.include(["dbo"]);
        expect(offeredLabels).to.deep.include(["dbo.Orders"]);
        expect(result).to.equal(orders);
    });
});
