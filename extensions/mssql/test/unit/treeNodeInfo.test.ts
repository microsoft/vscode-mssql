/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";

import type { IConnectionInfo } from "vscode-mssql";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { initializeIconUtils } from "./utils";
import { IConnectionProfile } from "../../src/models/interfaces";
import { azureMfa } from "../../src/constants/constants";
import { removeUndefinedProperties } from "../../src/utils/utils";

chai.use(sinonChai);

suite("TreeNodeInfo", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        initializeIconUtils();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("When creating multiple TreeNodeInfo in quick succession, the nodePath should be unique", () => {
        const node1 = new TreeNodeInfo(
            "node_label",
            undefined,
            undefined,
            "node_path",
            undefined,
            undefined,
            "session_id",
            undefined,
            undefined,
            undefined,
            undefined,
        );

        const node2 = new TreeNodeInfo(
            "node_label",
            undefined,
            undefined,
            "node_path",
            undefined,
            undefined,
            "session_id",
            undefined,
            undefined,
            undefined,
            undefined,
        );

        expect(node1.id).to.not.equal(node2.id, "Node IDs should be unique");
    });

    test("loadingLabel can be set and retrieved", () => {
        const newLabel = "TestValue";
        const node = createTreeNode();
        expect(node.loadingLabel).to.not.equal(newLabel);

        node.loadingLabel = newLabel;
        expect(node.loadingLabel).to.equal(newLabel);
    });

    test("marks loopback profiles for local deployment without matching remote lookalikes", () => {
        for (const server of [
            "localhost,1433",
            "tcp:127.0.0.1,1433",
            "[::1],1433",
            ".\\SQLEXPRESS",
        ]) {
            expect(createTreeNode({ server }).contextValue).to.include("localToCloud=true,");
        }
        for (const server of ["localhost.example.com", "127.0.0.1.example.com", "remote-server"]) {
            expect(createTreeNode({ server }).contextValue).not.to.include("localToCloud=true,");
        }
    });

    test("updates local deployment eligibility when a node's connection profile changes", () => {
        const node = createTreeNode({ server: "localhost" });
        node.filters = [];
        expect(node.contextValue).to.include("localToCloud=true,");
        node.updateConnectionProfile({ ...node.connectionProfile, server: "remote-server" });
        expect(node.contextValue).not.to.include("localToCloud=true,");
    });

    suite("updateEntraTokenInfo", () => {
        test("updates only Entra token fields when refreshed token is provided", () => {
            const oldToken = {
                azureAccountToken: "oldToken",
                expiresOn: Date.now() / 1000 - 60, // 60 seconds in the past; not that the test actually requires this to be expired
            };

            const newToken = {
                azureAccountToken: "refreshedToken",
                expiresOn: oldToken.expiresOn + 600 + 60, // 10 minutes in the future (plus making up for the past offset)
            };

            const node = createTreeNode({
                server: "testServer",
                authenticationType: azureMfa,
                user: "test@contoso.com",
                ...oldToken,
            });
            const updateSpy = sandbox.spy(node, "updateConnectionProfile");

            expect(node.connectionProfile.azureAccountToken).to.equal(oldToken.azureAccountToken);
            expect(node.connectionProfile.expiresOn).to.equal(oldToken.expiresOn);

            node.updateEntraTokenInfo({
                ...newToken,
            } as IConnectionProfile);

            expect(updateSpy).to.have.been.calledOnce;
            expect(node.connectionProfile.azureAccountToken).to.equal(newToken.azureAccountToken);
            expect(node.connectionProfile.expiresOn).to.equal(newToken.expiresOn);
            expect(node.connectionProfile.server, "Server should not be changed").to.equal(
                "testServer",
            );
            expect(
                node.connectionProfile.authenticationType,
                "authenticationType should not be changed",
            ).to.equal(azureMfa);
            expect(node.connectionProfile.user, "user should not be changed").to.equal(
                "test@contoso.com",
            );
        });

        test("ignores Entra token update when both fields are undefined", () => {
            const node = createTreeNode();
            const updateSpy = sandbox.spy(node, "updateConnectionProfile");

            node.updateEntraTokenInfo({} as IConnectionProfile);

            expect(updateSpy).to.not.have.been.called;
            const profile = node.connectionProfile;
            expect(profile.azureAccountToken).to.equal("oldToken");
            expect(profile.expiresOn).to.equal(111);
        });

        test("no op when no credentials are passed", () => {
            const node = createTreeNode();
            const removedUndefinedSpy = sandbox.spy(removeUndefinedProperties);
            node.updateEntraTokenInfo(undefined);

            expect(removedUndefinedSpy).to.not.have.been.called;
        });
    });
});
function createTreeNode(overrides: Partial<IConnectionInfo> = {}): TreeNodeInfo {
    const baseProfile: IConnectionProfile = {
        id: "id",
        profileName: "profile",
        groupId: "group",
        savePassword: false,
        emptyPasswordInput: false,
        azureAuthType: 0,
        accountStore: undefined,
        server: "server",
        database: "db",
        azureAccountToken: "oldToken",
        expiresOn: 111,
        ...overrides,
    } as IConnectionProfile;

    return new TreeNodeInfo(
        "label",
        { type: "Server", filterable: false, hasFilters: false, subType: undefined },
        vscode.TreeItemCollapsibleState.None,
        "nodePath",
        "ready",
        "Server",
        "session",
        baseProfile,
        undefined as unknown as TreeNodeInfo,
        [],
        undefined,
        undefined,
        undefined,
    );
}
