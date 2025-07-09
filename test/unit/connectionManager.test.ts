/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";
import { ConnectionDetails, IToken } from "vscode-mssql";
import { ConnectionStore } from "../../src/models/connectionStore";
import { Logger } from "../../src/models/logger";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import StatusView from "../../src/views/statusView";
import { CredentialStore } from "../../src/credentialstore/credentialstore";
import { IConnectionProfile, IConnectionProfileWithSource } from "../../src/models/interfaces";
import { ParseConnectionStringRequest } from "../../src/models/contracts/connection";
import { RequestSecurityTokenParams } from "../../src/models/contracts/azure";
import { AzureController } from "../../src/azure/azureController";

suite("ConnectionManager Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionManager: ConnectionManager;

    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let mockLogger: TypeMoq.IMock<Logger>;
    let mockCredentialStore: TypeMoq.IMock<CredentialStore>;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let mockConnectionStore: TypeMoq.IMock<ConnectionStore>;
    let mockServiceClient: TypeMoq.IMock<SqlToolsServerClient>;
    let mockStatusView: TypeMoq.IMock<StatusView>;

    setup(async () => {
        sandbox = sinon.createSandbox();

        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockVscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        mockLogger = TypeMoq.Mock.ofType<Logger>();
        mockConnectionStore = TypeMoq.Mock.ofType<ConnectionStore>();
        mockCredentialStore = TypeMoq.Mock.ofType<CredentialStore>();
        mockServiceClient = TypeMoq.Mock.ofType(SqlToolsServerClient, TypeMoq.MockBehavior.Loose);
        mockStatusView = TypeMoq.Mock.ofType<StatusView>(undefined, TypeMoq.MockBehavior.Loose);

        mockConnectionStore
            .setup((c) => c.readAllConnections(TypeMoq.It.isAny()))
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
                connectionManager = new ConnectionManager(
                    mockContext.object,
                    mockStatusView.object,
                    undefined, // prompter
                    true, // isRichExperiencesEnabled
                    mockLogger.object,
                    mockServiceClient.object,
                    mockVscodeWrapper.object,
                    mockConnectionStore.object,
                    mockCredentialStore.object,
                    undefined, // connectionUI
                    undefined, // accountStore
                );
            }).to.not.throw();

            await connectionManager.initialized; // Wait for initialization to complete
        });

        test("Initialization migrates legacy Connection String connections in credential store", async () => {
            const testServer = "localhost";
            const testDatabase = "TestDb";
            const testUser = "testUser";
            const testPassword = "testPassword";
            const testConnectionString = `Data Source=${testServer};Initial Catalog=${testDatabase};User Id=${testUser};Password=${testPassword}`;
            const testCredentialId = `Microsoft.SqlTools|itemtype:Profile|server:${testServer}|db:${testDatabase}|user:${testUser}|isConnectionString:true`;
            const testConnectionId = "00000000-1111-2222-3333-444444444444";

            mockCredentialStore
                .setup((cs) => cs.readCredential(TypeMoq.It.isAny()))
                .returns((credId: string) => {
                    return Promise.resolve({
                        credentialId: credId,
                        password: testConnectionString,
                    });
                });

            mockConnectionStore.reset();

            mockConnectionStore
                .setup((cs) => cs.readAllConnections(TypeMoq.It.isAny()))
                .returns(() => {
                    return Promise.resolve([
                        {
                            id: testConnectionId,
                            connectionString: testCredentialId,
                            server: testServer,
                            database: testDatabase,
                            user: testUser,
                        } as IConnectionProfileWithSource,
                    ]);
                });

            mockConnectionStore
                .setup((cs) => cs.lookupPassword(TypeMoq.It.isAny(), true))
                .returns(() => {
                    return Promise.resolve(testConnectionString);
                });

            let savedProfile: IConnectionProfile;

            mockConnectionStore
                .setup((cs) => cs.saveProfile(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns((profile: IConnectionProfile) => {
                    savedProfile = profile;
                    return Promise.resolve(profile);
                });

            mockServiceClient
                .setup((sc) =>
                    sc.sendRequest(
                        TypeMoq.It.isValue(ParseConnectionStringRequest.type),
                        TypeMoq.It.isAny(),
                    ),
                )
                .returns(() => {
                    return Promise.resolve({
                        options: {
                            server: testServer,
                            database: testDatabase,
                            user: testUser,
                            password: testPassword,
                        },
                    } as ConnectionDetails);
                });

            connectionManager = new ConnectionManager(
                mockContext.object,
                mockStatusView.object,
                undefined, // prompter
                true, // isRichExperiencesEnabled
                mockLogger.object,
                mockServiceClient.object,
                mockVscodeWrapper.object,
                mockConnectionStore.object,
                mockCredentialStore.object,
                undefined, // connectionUI
                undefined, // accountStore
            );

            await connectionManager.initialized; // Wait for initialization to complete

            expect(savedProfile, "Migrated profile should have been saved").to.not.be.undefined;

            expect(savedProfile, "Saved profile should have the expected properties").to.deep.equal(
                {
                    id: testConnectionId,
                    server: testServer,
                    database: testDatabase,
                    connectionString: "",
                    savePassword: true,
                    user: testUser,
                    password: testPassword,
                } as IConnectionProfile,
            );
        });

        test("Initialization migrates legacy Connection String connections with no credential", async () => {
            const testServer = "localhost";
            const testDatabase = "TestDb";
            const testConnectionString = `Data Source=${testServer};Initial Catalog=${testDatabase};Integrated Security=True;`;
            const testConnectionId = "00000000-1111-2222-3333-444444444444";
            mockCredentialStore
                .setup((cs) => cs.readCredential(TypeMoq.It.isAny()))
                .returns((credId: string) => {
                    return Promise.resolve({
                        credentialId: credId,
                        password: testConnectionString,
                    });
                });

            mockConnectionStore.reset();

            mockConnectionStore
                .setup((cs) => cs.readAllConnections(TypeMoq.It.isAny()))
                .returns(() => {
                    return Promise.resolve([
                        {
                            id: testConnectionId,
                            connectionString: testConnectionString,
                            server: testServer,
                            database: testDatabase,
                        } as IConnectionProfileWithSource,
                    ]);
                });

            let savedProfile: IConnectionProfile;

            mockConnectionStore
                .setup((cs) => cs.saveProfile(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns((profile: IConnectionProfile) => {
                    savedProfile = profile;
                    return Promise.resolve(profile);
                });

            mockServiceClient
                .setup((sc) =>
                    sc.sendRequest(
                        TypeMoq.It.isValue(ParseConnectionStringRequest.type),
                        TypeMoq.It.isAny(),
                    ),
                )
                .returns(() => {
                    return Promise.resolve({
                        options: {
                            server: testServer,
                            database: testDatabase,
                            authenticationType: "Integrated",
                        },
                    } as ConnectionDetails);
                });

            connectionManager = new ConnectionManager(
                mockContext.object,
                mockStatusView.object,
                undefined, // prompter
                true, // isRichExperiencesEnabled
                mockLogger.object,
                mockServiceClient.object,
                mockVscodeWrapper.object,
                mockConnectionStore.object,
                mockCredentialStore.object,
                undefined, // connectionUI
                undefined, // accountStore
            );

            await connectionManager.initialized; // Wait for initialization to complete

            expect(savedProfile, "Migrated profile should have been saved").to.not.be.undefined;

            expect(savedProfile, "Saved profile should have the expected properties").to.deep.equal(
                {
                    id: testConnectionId,
                    server: testServer,
                    database: testDatabase,
                    authenticationType: "Integrated",
                    connectionString: "",
                } as IConnectionProfile,
            );
        });
    });

    suite("Functionality tests", () => {
        setup(() => {
            connectionManager = new ConnectionManager(
                mockContext.object,
                mockStatusView.object,
                undefined, // prompter
                true, // isRichExperiencesEnabled
                mockLogger.object,
                mockServiceClient.object,
                mockVscodeWrapper.object,
                mockConnectionStore.object,
                mockCredentialStore.object,
                undefined, // connectionUI
                undefined, // accountStore
            );
        });

        test("User is informed when legacy connection migration fails", async () => {
            const erroringConnProfile: IConnectionProfile = {
                connectionString: "some test connection string",
                id: "00000000-1111-2222-3333-444444444444",
            } as IConnectionProfile;

            mockVscodeWrapper
                .setup((x) => x.showErrorMessage(TypeMoq.It.isAny()))
                .returns(() => {
                    return Promise.resolve(undefined);
                });

            mockServiceClient
                .setup((sc) =>
                    sc.sendRequest(
                        TypeMoq.It.isValue(ParseConnectionStringRequest.type),
                        TypeMoq.It.isAny(),
                    ),
                )
                .returns(() => {
                    throw new Error("Test error!");
                });

            const result = await connectionManager["migrateLegacyConnection"](erroringConnProfile);

            expect(result, "Migration should return that it errored instead of throwing").to.equal(
                "error",
            );

            mockVscodeWrapper.verify(
                (v) => v.showErrorMessage(TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
        });
    });

    suite("Token request handling", () => {
        setup(() => {
            connectionManager = new ConnectionManager(
                mockContext.object,
                mockStatusView.object,
                undefined, // prompter
                true, // isRichExperiencesEnabled
                mockLogger.object,
                mockServiceClient.object,
                mockVscodeWrapper.object,
                mockConnectionStore.object,
                mockCredentialStore.object,
                undefined, // connectionUI
                undefined, // accountStore
            );
        });
        test("should return cached token when valid", async () => {
            const params: RequestSecurityTokenParams = {
                resource: "test-resource",
                provider: "",
                authority: "",
                scopes: [],
            };
            const cachedToken: IToken = {
                key: "cached-key",
                token: "cached-token",
                tokenType: "test",
                expiresOn: Date.now() / 1000 + 3600, // 1 hour from now
            };

            connectionManager["_keyVaultTokenCache"].set(JSON.stringify(params), cachedToken);

            const result = await connectionManager["handleSecurityTokenRequest"](params);

            expect(result).to.deep.equal(
                {
                    accountKey: cachedToken.key,
                    token: cachedToken.token,
                },
                "Should return cached token",
            );
        });

        test("should return new token when no valid cached token exists", async () => {
            const params: RequestSecurityTokenParams = {
                resource: "test-resource",
                provider: "",
                authority: "",
                scopes: [],
            };

            connectionManager["_keyVaultTokenCache"].clear();
            connectionManager["selectAccount"] = sinon.stub();
            connectionManager["selectTenantId"] = sinon.stub();
            const stubbedAzureController = TypeMoq.Mock.ofType<AzureController>();
            const token: IToken = {
                key: "new-key",
                token: "new-token",
                tokenType: "test",
                expiresOn: Date.now() / 1000 + 3600, // 1 hour from now
            };
            stubbedAzureController
                .setup((x) =>
                    x.getAccountSecurityToken(
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                    ),
                )
                .returns(() => {
                    return Promise.resolve(token);
                });
            connectionManager.azureController = stubbedAzureController.object;

            const result = await connectionManager["handleSecurityTokenRequest"](params);

            expect(result).to.deep.equal(
                {
                    accountKey: "new-key",
                    token: "new-token",
                },
                "Should return new token",
            );

            // verify new token is cached
            expect(
                connectionManager["_keyVaultTokenCache"].get(JSON.stringify(params)),
            ).to.deep.equal(token, "New token should be cached");
        });
    });
});
