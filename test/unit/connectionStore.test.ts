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
import { IConnectionProfile } from "../../src/models/interfaces";

suite("ConnectionStore Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionStore: ConnectionStore;

    // let connectionStore: ConnectionStore;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let mockLogger: TypeMoq.IMock<Logger>;
    let mockCredentialStore: TypeMoq.IMock<ICredentialStore>;
    let mockConnectionConfig: TypeMoq.IMock<ConnectionConfig>;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;

    setup(async () => {
        sandbox = sinon.createSandbox();

        // Set up mocks
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

    suite("Initialization Tests", () => {
        test("Initializes correctly", async () => {
            expect(() => {
                connectionStore = new ConnectionStore(
                    mockContext.object,
                    mockLogger.object,
                    mockCredentialStore.object,
                    mockConnectionConfig.object,
                    mockVscodeWrapper.object,
                );
            }).to.not.throw();

            await connectionStore.initialized; // Wait for initialization to complete
        });

        test("Initialization migrates legacy Connection String connections", async () => {
            const testServer = "localhost";
            const testDatabase = "TestDb";
            const testUser = "testUser";
            const testPassword = "testPassword";
            const testConnectionString = `Data Source=${testServer};Initial Catalog=${testDatabase};User Id=${testUser};Password=${testPassword}`;
            const testCredentialId = "test_credential_id";
            const testConnectionId = "00000000-1111-2222-3333-444444444444";

            mockCredentialStore
                .setup((cs) => cs.readCredential(TypeMoq.It.isAny()))
                .returns((credId: string) => {
                    return Promise.resolve({
                        credentialId: credId,
                        password: testConnectionString,
                    });
                });

            let savedCredential;

            mockCredentialStore
                .setup((cs) => cs.saveCredential(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns((credId, password) => {
                    savedCredential = password;
                    return Promise.resolve(true);
                });

            mockConnectionConfig.reset();
            mockConnectionConfig
                .setup((c) => c.getConnections(TypeMoq.It.isAny()))
                .returns(() => {
                    return Promise.resolve([
                        {
                            id: testConnectionId,
                            connectionString: testCredentialId,
                            server: testServer,
                            database: testDatabase,
                            user: testUser,
                        } as IConnectionProfile,
                    ]);
                });

            let savedProfile: IConnectionProfile;

            mockConnectionConfig
                .setup((cc) => cc.addConnection(TypeMoq.It.isAny()))
                .returns((profile: IConnectionProfile) => {
                    savedProfile = profile;
                    return Promise.resolve();
                });

            connectionStore = new ConnectionStore(
                mockContext.object,
                mockLogger.object,
                mockCredentialStore.object,
                mockConnectionConfig.object,
                mockVscodeWrapper.object,
            );

            await connectionStore.initialized; // Wait for initialization to complete

            expect(savedProfile, "Migrated profile should have been saved").to.not.be.undefined;

            expect(savedProfile.id, "saved profile ID should be the same as the original").to.equal(
                testConnectionId,
            );

            expect(
                savedProfile.connectionString,
                "connection string should not be set after migration",
            ).to.equal("");

            expect(
                savedProfile.savePassword,
                "savePassword should be true when a connection string containing a password has been migrated",
            ).to.be.true;

            expect(
                savedCredential,
                "password extracted from the connection string should have been saved",
            ).to.equal(testPassword);
        });
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

        credentialId = ConnectionStore.formatCredentialId(
            testServer,
            testDatabase,
            undefined, // user
            undefined, // itemType
            undefined, // isConnectionString
        );

        expect(credentialId).to.equal(
            "Microsoft.SqlTools|itemtype:Profile|server:localhost|db:TestDb",
        );

        credentialId = ConnectionStore.formatCredentialId(
            testServer,
            undefined, // database
            undefined, // user
            undefined, // itemType
            undefined, // isConnectionString
        );

        expect(credentialId).to.equal("Microsoft.SqlTools|itemtype:Profile|server:localhost");
    });
});
