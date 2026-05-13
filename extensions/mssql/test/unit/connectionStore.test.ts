/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as Constants from "../../src/constants/constants";
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
        (mockContext.globalState.update as sinon.SinonStub).resolves();
        mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        mockVscodeWrapper.getConfiguration.returns({
            [Constants.configMaxRecentConnections]: 5,
        } as unknown as vscode.WorkspaceConfiguration);
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

    test("getRecentlyUsedConnections applies an optional limit without truncating stored values", async () => {
        const recentConnections = [
            { server: "server-1", database: "db-1" },
            { server: "server-2", database: "db-2" },
            { server: "server-3", database: "db-3" },
        ];

        (mockContext.globalState.get as sinon.SinonStub)
            .withArgs(Constants.configRecentConnections)
            .returns(recentConnections);

        connectionStore = new ConnectionStore(
            mockContext,
            mockCredentialStore,
            mockLogger,
            mockConnectionConfig,
            mockVscodeWrapper,
        );

        await connectionStore.initialized;

        expect(connectionStore.getRecentlyUsedConnections()).to.deep.equal(recentConnections);
        expect(connectionStore.getRecentlyUsedConnections(2)).to.deep.equal(
            recentConnections.slice(0, 2),
        );
    });

    test("readAllConnections applies the recent connections limit without affecting saved entries", async () => {
        const savedConnection = {
            id: "saved-connection-id",
            profileSource: CredentialsQuickPickItemType.Profile,
            server: "saved-server",
            database: "saved-db",
        } as IConnectionProfileWithSource;
        const recentConnections = [
            {
                server: "recent-server-1",
                database: "recent-db-1",
            },
            {
                server: "recent-server-2",
                database: "recent-db-2",
            },
        ];

        mockConnectionConfig.getConnections.resolves([savedConnection]);
        (mockContext.globalState.get as sinon.SinonStub)
            .withArgs(Constants.configRecentConnections)
            .returns(recentConnections);

        connectionStore = new ConnectionStore(
            mockContext,
            mockCredentialStore,
            mockLogger,
            mockConnectionConfig,
            mockVscodeWrapper,
        );

        await connectionStore.initialized;

        const connections = await connectionStore.readAllConnections(true, 1);

        expect(connections).to.have.lengthOf(2);
        expect(connections).to.deep.include(savedConnection);
        expect(connections).to.deep.include({
            ...recentConnections[0],
            profileSource: CredentialsQuickPickItemType.Mru,
        });
        expect(connections).to.not.deep.include({
            ...recentConnections[1],
            profileSource: CredentialsQuickPickItemType.Mru,
        });
    });

    test("readAllConnections preserves saved and recent entries without ids when they share the same identity", async () => {
        const savedConnection = {
            profileSource: CredentialsQuickPickItemType.Profile,
            server: "shared-server",
            database: "shared-db",
            authenticationType: "SqlLogin",
            user: "shared-user",
        } as IConnectionProfileWithSource;
        const recentConnection = {
            profileSource: CredentialsQuickPickItemType.Mru,
            server: "shared-server",
            database: "shared-db",
            authenticationType: "SqlLogin",
            user: "shared-user",
        } as IConnectionProfileWithSource;

        mockConnectionConfig.getConnections.resolves([savedConnection]);
        (mockContext.globalState.get as sinon.SinonStub)
            .withArgs(Constants.configRecentConnections)
            .returns([recentConnection]);

        connectionStore = new ConnectionStore(
            mockContext,
            mockCredentialStore,
            mockLogger,
            mockConnectionConfig,
            mockVscodeWrapper,
        );

        await connectionStore.initialized;

        const connections = await connectionStore.readAllConnections(true);

        expect(connections).to.have.lengthOf(2);
        expect(connections).to.deep.include(savedConnection);
        expect(connections).to.deep.include(recentConnection);
    });

    test("addRecentlyUsed keeps separate MRU entries when only the database differs", async () => {
        const recentConnections = [
            {
                id: "shared-connection-id",
                profileName: "Shared Profile",
                server: "shared-server",
                database: "db-1",
                authenticationType: "SqlLogin",
                user: "shared-user",
            },
        ] as IConnectionProfile[];
        const newRecentConnection = {
            id: "shared-connection-id",
            profileName: "Shared Profile",
            server: "shared-server",
            database: "db-2",
            authenticationType: "SqlLogin",
            user: "shared-user",
        } as IConnectionProfile;

        connectionStore = new ConnectionStore(
            mockContext,
            mockCredentialStore,
            mockLogger,
            mockConnectionConfig,
            mockVscodeWrapper,
        );

        await connectionStore.initialized;

        sandbox.stub(connectionStore, "getRecentlyUsedConnections").returns(recentConnections);

        await connectionStore.addRecentlyUsed(newRecentConnection);

        const storedConnectionsMatch = sinon.match((storedConnections: IConnectionProfile[]) => {
            return (
                storedConnections.length === 2 &&
                storedConnections.some((conn) => conn.database === "db-1") &&
                storedConnections.some((conn) => conn.database === "db-2")
            );
        });

        expect(
            (mockContext.globalState.update as sinon.SinonStub).calledWith(
                Constants.configRecentConnections,
                storedConnectionsMatch,
            ),
        ).to.be.true;
    });

    test("removeRecentlyUsed removes only the matching MRU database variant", async () => {
        const recentConnections = [
            {
                id: "shared-connection-id",
                profileName: "Shared Profile",
                server: "shared-server",
                database: "db-1",
                authenticationType: "SqlLogin",
                user: "shared-user",
            },
            {
                id: "shared-connection-id",
                profileName: "Shared Profile",
                server: "shared-server",
                database: "db-2",
                authenticationType: "SqlLogin",
                user: "shared-user",
            },
        ] as IConnectionProfile[];

        connectionStore = new ConnectionStore(
            mockContext,
            mockCredentialStore,
            mockLogger,
            mockConnectionConfig,
            mockVscodeWrapper,
        );

        await connectionStore.initialized;

        sandbox.stub(connectionStore, "getRecentlyUsedConnections").returns(recentConnections);

        await connectionStore.removeRecentlyUsed({
            id: "shared-connection-id",
            profileName: "Shared Profile",
            server: "shared-server",
            database: "db-2",
            authenticationType: "SqlLogin",
            user: "shared-user",
        } as IConnectionProfile);

        const remainingConnectionsMatch = sinon.match((storedConnections: IConnectionProfile[]) => {
            return storedConnections.length === 1 && storedConnections[0].database === "db-1";
        });

        expect(
            (mockContext.globalState.update as sinon.SinonStub).calledWith(
                Constants.configRecentConnections,
                remainingConnectionsMatch,
            ),
        ).to.be.true;
    });
});
