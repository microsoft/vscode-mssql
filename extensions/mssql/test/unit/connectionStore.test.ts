/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ConnectionStore } from "../../src/models/connectionStore";
import { CredentialStore } from "../../src/credentialstore/credentialstore";
import { Logger } from "../../src/models/logger";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import {
    CredentialsQuickPickItemType,
    IConnectionProfile,
    IConnectionProfileWithSource,
} from "../../src/models/interfaces";
import { MatchScore } from "../../src/models/utils";
import { Deferred } from "../../src/protocol";
import { azureAuthConn, sqlAuthConn, connStringConn } from "./utils.test";
import { createStubLogger, stubExtensionContext } from "./utils";

suite("ConnectionStore Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionStore: ConnectionStore;

    let mockContext: vscode.ExtensionContext;
    let mockLogger: sinon.SinonStubbedInstance<Logger>;
    let mockCredentialStore: sinon.SinonStubbedInstance<CredentialStore>;
    let mockConnectionConfig: sinon.SinonStubbedInstance<ConnectionConfig>;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let initializedDeferred: Deferred<void>;

    setup(async () => {
        sandbox = sinon.createSandbox();

        mockContext = stubExtensionContext(sandbox);
        mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        mockLogger = createStubLogger(sandbox);

        mockCredentialStore = sandbox.createStubInstance(CredentialStore);
        mockCredentialStore.readCredential.resolves(undefined);
        mockCredentialStore.saveCredential.resolves(true);
        mockCredentialStore.deleteCredential.resolves();

        mockConnectionConfig = sandbox.createStubInstance(ConnectionConfig);
        initializedDeferred = new Deferred<void>();
        initializedDeferred.resolve();
        mockConnectionConfig.initialized = initializedDeferred;
        mockConnectionConfig.getConnections.resolves([]);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Initializes correctly", async () => {
        expect(() => {
            connectionStore = new ConnectionStore(
                mockContext,
                mockCredentialStore,
                mockLogger,
                mockConnectionConfig,
                mockVscodeWrapper,
            );
        }).to.not.throw();

        await connectionStore.initialized; // Wait for initialization to complete
    });

    test("formatCredentialId", () => {
        const testServer = "localhost";
        const testDatabase = "TestDb";
        const testUser = "testUser";

        let credentialId = ConnectionStore.formatCredentialId(
            testServer,
            testDatabase,
            testUser,
            ConnectionStore.CRED_MRU_USER,
            false, // isConnectionString
        );

        expect(credentialId).to.equal(
            "Microsoft.SqlTools|itemtype:Mru|server:localhost|db:TestDb|user:testUser",
        );

        credentialId = ConnectionStore.formatCredentialId(
            testServer,
            testDatabase,
            testUser,
            undefined, // itemType
            true, // isConnectionString
        );

        expect(credentialId).to.equal(
            "Microsoft.SqlTools|itemtype:Profile|server:localhost|db:TestDb|user:testUser|isConnectionString:true",
        );

        credentialId = ConnectionStore.formatCredentialId(testServer, testDatabase);

        expect(credentialId).to.equal(
            "Microsoft.SqlTools|itemtype:Profile|server:localhost|db:TestDb",
        );

        credentialId = ConnectionStore.formatCredentialId(testServer);

        expect(credentialId).to.equal("Microsoft.SqlTools|itemtype:Profile|server:localhost");
    });

    test("findMatchingProfile", async () => {
        connectionStore = new ConnectionStore(
            mockContext,
            mockCredentialStore,
            mockLogger,
            mockConnectionConfig,
            mockVscodeWrapper,
        );

        await connectionStore.initialized;

        sandbox
            .stub(connectionStore, "readAllConnections")
            .resolves([
                sqlAuthConn as IConnectionProfileWithSource,
                azureAuthConn as IConnectionProfileWithSource,
                connStringConn as IConnectionProfileWithSource,
            ]);

        let match = await connectionStore.findMatchingProfile(azureAuthConn);
        expect(match).to.deep.equal({
            profile: azureAuthConn,
            score: MatchScore.AllAvailableProps,
        });

        match = await connectionStore.findMatchingProfile({
            server: "noMatch",
        } as IConnectionProfile);
        expect(match).to.deep.equal({
            profile: undefined,
            score: MatchScore.NotMatch,
        });
    });

    test("readAllConnections preserves saved and recent entries that share the same id", async () => {
        const sharedId = "shared-connection-id";
        const savedConnection = {
            id: sharedId,
            profileSource: CredentialsQuickPickItemType.Profile,
            server: "saved-server",
            database: "saved-db",
        } as IConnectionProfileWithSource;
        const recentConnection = {
            id: sharedId,
            profileSource: CredentialsQuickPickItemType.Mru,
            server: "recent-server",
            database: "recent-db",
        } as IConnectionProfileWithSource;

        mockConnectionConfig.getConnections.resolves([savedConnection]);

        connectionStore = new ConnectionStore(
            mockContext,
            mockCredentialStore,
            mockLogger,
            mockConnectionConfig,
            mockVscodeWrapper,
        );

        await connectionStore.initialized;
        sandbox.stub(connectionStore, "getRecentlyUsedConnections").returns([recentConnection]);

        const connections = await connectionStore.readAllConnections(true);

        expect(connections).to.have.lengthOf(2);
        expect(connections).to.deep.include(savedConnection);
        expect(connections).to.deep.include(recentConnection);
    });
});
