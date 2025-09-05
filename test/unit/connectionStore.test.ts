/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import { ConnectionStore } from "../../src/models/connectionStore";
import { ICredentialStore } from "../../src/credentialstore/icredentialstore";
import { Logger } from "../../src/models/logger";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { expect } from "chai";
import * as sinon from "sinon";
import { azureAuthConn, sqlAuthConn, connStringConn } from "./utils.test";
import { IConnectionProfile, IConnectionProfileWithSource } from "../../src/models/interfaces";
import { MatchScore } from "../../src/models/utils";

suite("ConnectionStore Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionStore: ConnectionStore;

    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let mockLogger: TypeMoq.IMock<Logger>;
    let mockCredentialStore: TypeMoq.IMock<ICredentialStore>;
    let mockConnectionConfig: TypeMoq.IMock<ConnectionConfig>;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;

    setup(async () => {
        sandbox = sinon.createSandbox();

        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockVscodeWrapper = TypeMoq.Mock.ofType<VscodeWrapper>();
        mockLogger = TypeMoq.Mock.ofType<Logger>();
        mockCredentialStore = TypeMoq.Mock.ofType<ICredentialStore>();
        mockConnectionConfig = TypeMoq.Mock.ofType<ConnectionConfig>();

        mockConnectionConfig
            .setup((c) => c.getConnections(TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve([]);
            });
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Initializes correctly", async () => {
        expect(() => {
            connectionStore = new ConnectionStore(
                mockContext.object,
                mockCredentialStore.object,
                mockLogger.object,
                mockConnectionConfig.object,
                mockVscodeWrapper.object,
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
            mockContext.object,
            mockCredentialStore.object,
            mockLogger.object,
            mockConnectionConfig.object,
            mockVscodeWrapper.object,
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
});
