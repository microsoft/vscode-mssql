/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import { ExtensionContextService } from "extension-toolkit/vscode";

import {
    ConnectionGroupWebviewController,
    createConnectionGroupFromSpec,
    getConnectionGroupDialogState,
} from "../../src/controllers/connectionGroupWebviewController";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import { IConnectionGroup } from "../../src/models/interfaces";

suite("ConnectionGroupWebviewController Tests", () => {
    let controller: ConnectionGroupWebviewController;
    let mockContext: vscode.ExtensionContext;
    let contextService: ExtensionContextService;
    let connectionConfig: ConnectionConfig;
    let groups: IConnectionGroup[];

    setup(() => {
        mockContext = {
            extensionUri: vscode.Uri.parse("file://fakePath"),
            extensionPath: "fakePath",
            subscriptions: [],
        } as vscode.ExtensionContext;
        contextService = new ExtensionContextService(mockContext);
        groups = [
            {
                id: ConnectionConfig.ROOT_GROUP_ID,
                name: ConnectionConfig.ROOT_GROUP_ID,
                configSource: vscode.ConfigurationTarget.Global,
            },
            {
                id: "parent",
                name: "Parent",
                parentId: ConnectionConfig.ROOT_GROUP_ID,
                color: "#0078D4",
                configSource: vscode.ConfigurationTarget.Global,
            },
            {
                id: "child",
                name: "Child",
                parentId: "parent",
                configSource: vscode.ConfigurationTarget.Global,
            },
        ];
        connectionConfig = {
            getGroupsFromSettings: () => groups,
        } as ConnectionConfig;

        controller = new ConnectionGroupWebviewController(
            undefined,
            undefined,
            contextService,
            connectionConfig,
        );
    });

    test("uses the lowercase bundle name for webview resources", () => {
        expect(controller.panel.webview.html).to.contain('href="connectionGroup.css"');
        expect(controller.panel.webview.html).to.contain('src="connectionGroup.js"');
    });

    test("distinct instances share the same injected connection configuration", () => {
        const secondController = new ConnectionGroupWebviewController(
            undefined,
            undefined,
            contextService,
            connectionConfig,
        );

        expect(secondController).to.not.equal(controller);
        expect(secondController["connectionConfig"]).to.equal(controller["connectionConfig"]);
        expect(secondController["connectionConfig"]).to.equal(connectionConfig);

        secondController.dispose();
    });

    test("defaults new groups to the root group", () => {
        const state = getConnectionGroupDialogState(groups);

        expect(state.parentId).to.equal(ConnectionConfig.ROOT_GROUP_ID);
        expect(state.parentGroups[0]).to.deep.equal({
            id: ConnectionConfig.ROOT_GROUP_ID,
            name: ConnectionConfig.ROOT_GROUP_ID,
            color: undefined,
            isRoot: true,
        });
    });

    test("uses the preselected parent and displays nested group paths", () => {
        const state = getConnectionGroupDialogState(groups, undefined, "child");

        expect(state.parentId).to.equal("child");
        expect(state.parentGroups.find((group) => group.id === "child")?.name).to.equal(
            "Parent / Child",
        );
        expect(state.parentGroups.find((group) => group.id === "parent")?.color).to.equal(
            "#0078D4",
        );
    });

    test("excludes an edited group and its descendants from parent choices", () => {
        const state = getConnectionGroupDialogState(groups, groups[1]);

        expect(state.parentId).to.equal(ConnectionConfig.ROOT_GROUP_ID);
        expect(state.parentGroups.map((group) => group.id)).to.deep.equal([
            ConnectionConfig.ROOT_GROUP_ID,
        ]);
    });

    test("preserves the current parent when editing a nested group", () => {
        const state = getConnectionGroupDialogState(groups, groups[2]);

        expect(state.parentId).to.equal("parent");
        expect(state.parentGroups.map((group) => group.id)).to.deep.equal([
            ConnectionConfig.ROOT_GROUP_ID,
            "parent",
        ]);
    });

    test("preserves the selected parent when creating a group", () => {
        const group = createConnectionGroupFromSpec({
            name: "New group",
            parentId: "parent",
        });

        expect(group.parentId).to.equal("parent");
    });

    teardown(() => {
        controller.dispose();
    });
});
