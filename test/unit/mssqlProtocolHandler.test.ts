/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import { MssqlProtocolHandler } from "../../src/mssqlProtocolHandler";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { Uri } from "vscode";
import { mockGetCapabilitiesRequest } from "./mocks";
import { Logger } from "../../src/models/logger";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import MainController from "../../src/controllers/mainController";
import { generateUUID } from "../e2e/baseFixtures";
import ConnectionManager from "../../src/controllers/connectionManager";
import { MatchScore } from "../../src/models/utils";
import { IConnectionProfile } from "../../src/models/interfaces";

chai.use(sinonChai);

suite("MssqlProtocolHandler Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mssqlProtocolHandler: MssqlProtocolHandler;
    let sqlToolsServiceClientMock: TypeMoq.IMock<SqlToolsServiceClient>;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockLogger: sinon.SinonStubbedInstance<Logger>;
    let mockMainController: sinon.SinonStubbedInstance<MainController>;
    let openConnectionDialogStub: sinon.SinonStub;
    let connectProfileStub: sinon.SinonStub;

    const testServer = "TestServer";
    const testDatabase = "TestDatabase";
    const tenantId = "11111";
    const accountId = `00000.${tenantId}`;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        mockLogger = sandbox.createStubInstance(Logger);
        mockMainController = sandbox.createStubInstance(MainController);

        const outputChannel = sinon.stub({
            append: () => sinon.stub(),
            appendLine: () => sinon.stub(),
        }) as unknown as vscode.OutputChannel;

        sinon.stub(mockVscodeWrapper, "outputChannel").get(() => {
            return outputChannel;
        });

        sandbox.stub(Logger, "create").returns(mockLogger);

        sqlToolsServiceClientMock = TypeMoq.Mock.ofType(
            SqlToolsServiceClient,
            TypeMoq.MockBehavior.Loose,
        );

        mockGetCapabilitiesRequest(sqlToolsServiceClientMock);

        mssqlProtocolHandler = new MssqlProtocolHandler(
            mockVscodeWrapper,
            mockMainController,
            sqlToolsServiceClientMock.object,
        );

        openConnectionDialogStub = sandbox.stub(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mssqlProtocolHandler as any,
            "openConnectionDialog",
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connectProfileStub = sandbox.stub(mssqlProtocolHandler as any, "connectProfile").resolves();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("No command", async () => {
        await mssqlProtocolHandler.handleUri(Uri.parse("vscode://ms-mssql.mssql/"));

        expect(openConnectionDialogStub).to.have.been.calledOnceWith(undefined);
    });

    suite("Connect command", () => {
        test("Should open connection dialog when no query is provided", async () => {
            await mssqlProtocolHandler.handleUri(Uri.parse("vscode://ms-mssql.mssql/connect"));

            expect(openConnectionDialogStub).to.have.been.calledOnceWith(undefined);
            expect(connectProfileStub).to.not.have.been.called;
        });

        test("Should find matching profile when connection string is provided", async () => {
            const connString = `Server=myServerAddress;Database=myDataBase;User Id=myUsername;Password=${generateUUID()};`;
            const mockConnectionManager = sandbox.createStubInstance(ConnectionManager);

            sandbox.stub(mockMainController, "connectionManager").get(() => {
                return mockConnectionManager;
            });

            mockConnectionManager.findMatchingProfile.resolves({
                profile: { connectionString: connString } as IConnectionProfile,
                score: MatchScore.AllAvailableProps,
            });

            await mssqlProtocolHandler.handleUri(
                Uri.parse(
                    `vscode://ms-mssql.mssql/connect?connectionString=${encodeURIComponent(connString)}`,
                ),
            );

            expect(connectProfileStub).to.have.been.calledOnceWith({
                connectionString: connString,
            });

            expect(openConnectionDialogStub).to.not.have.been.called;
        });

        test("Should find matching profile when parameters are provided", async () => {
            const params: Record<string, string> = {
                server: "myServer",
                database: "dbName",
                user: "testUser",
            };

            const mockConnectionManager = sandbox.createStubInstance(ConnectionManager);

            sandbox.stub(mockMainController, "connectionManager").get(() => {
                return mockConnectionManager;
            });

            mockConnectionManager.findMatchingProfile.resolves({
                profile: {
                    server: "myServer",
                    database: "dbName",
                    user: "testUser",
                } as IConnectionProfile,
                score: MatchScore.ServerDatabaseAndAuth,
            });

            await mssqlProtocolHandler.handleUri(
                Uri.parse(
                    `vscode://ms-mssql.mssql/connect?${new URLSearchParams(params).toString()}`,
                ),
            );

            expect(connectProfileStub).to.have.been.calledOnceWith(params);
            expect(openConnectionDialogStub).to.not.have.been.called;
        });

        test("Should ignore partially-matching profile when additional specifiers do not match", async () => {
            // Case 1: database specified but doesn't match
            const params: Record<string, string> = {
                server: testServer,
                database: testDatabase,
            };

            const mockConnectionManager = sandbox.createStubInstance(ConnectionManager);

            sandbox.stub(mockMainController, "connectionManager").get(() => {
                return mockConnectionManager;
            });

            mockConnectionManager.findMatchingProfile.resolves({
                profile: {
                    server: testServer, // database not set
                } as IConnectionProfile,
                score: MatchScore.Server,
            });

            await mssqlProtocolHandler.handleUri(
                Uri.parse(
                    `vscode://ms-mssql.mssql/connect?${new URLSearchParams(params).toString()}`,
                ),
            );

            expect(
                connectProfileStub,
                "Should not have connected because database was specified, but not in best profile match",
            ).to.not.have.been.called;
            expect(openConnectionDialogStub).to.have.been.called;

            // Case 2: auth info specified but doesn't match
            params["accountId"] = accountId;

            mockConnectionManager.findMatchingProfile.reset();
            mockConnectionManager.findMatchingProfile.resolves({
                profile: {
                    server: testServer,
                    database: testDatabase,
                    accountId: "00000.22222", // different accountId
                } as IConnectionProfile,
                score: MatchScore.ServerAndDatabase,
            });

            expect(
                connectProfileStub,
                "Should not have connected because accountId was specified, but didn't match with the best available profile",
            ).to.not.have.been.called;
            expect(openConnectionDialogStub).to.have.been.called;
        });

        test("Should open connection dialog with populated parameters when no matching profile is found", async () => {
            const params: Record<string, string> = {
                server: "myServer",
                database: "dbName",
                user: "testUser",
                authenticationType: "SqlLogin",
                connectTimeout: "15",
                trustServerCertificate: "true",
            };

            const mockConnectionManager = sandbox.createStubInstance(ConnectionManager);

            sandbox.stub(mockMainController, "connectionManager").get(() => {
                return mockConnectionManager;
            });

            const findMatchingProfileStub = mockConnectionManager.findMatchingProfile.resolves({
                profile: undefined,
                score: MatchScore.NotMatch,
            });

            await mssqlProtocolHandler.handleUri(
                Uri.parse(
                    `vscode://ms-mssql.mssql/connect?${new URLSearchParams(params).toString()}`,
                ),
            );

            expect(openConnectionDialogStub).to.have.been.calledOnceWith({
                ...params,
                // savePassword is auto-added, and non-string values are converted
                savePassword: true,
                connectTimeout: 15,
                trustServerCertificate: true,
            });
            expect(connectProfileStub).to.not.have.been.called;

            // Reset stubs for server-only test case

            findMatchingProfileStub.reset();
            openConnectionDialogStub.resetHistory();
            connectProfileStub.resetHistory();

            findMatchingProfileStub.resolves({
                profile: { server: "myServer", database: "otherDatabase" } as IConnectionProfile,
                score: MatchScore.Server,
            });

            await mssqlProtocolHandler.handleUri(
                Uri.parse(
                    `vscode://ms-mssql.mssql/connect?${new URLSearchParams(params).toString()}`,
                ),
            );

            expect(openConnectionDialogStub).to.have.been.calledOnceWith({
                ...params,
                // savePassword is auto-added, and non-string values are converted
                savePassword: true,
                connectTimeout: 15,
                trustServerCertificate: true,
            });
            expect(connectProfileStub).to.not.have.been.called;
        });
    });

    suite("OpenConnectionDialog command", () => {
        test("Should open blank connection dialog when no parameters are provided", async () => {
            await mssqlProtocolHandler.handleUri(
                Uri.parse("vscode://ms-mssql.mssql/openConnectionDialog"),
            );

            expect(openConnectionDialogStub).to.have.been.calledOnceWith(undefined);
            expect(connectProfileStub).to.not.have.been.called;
        });

        test("Should open populated connection dialog when parameters are provided", async () => {
            const params: Record<string, string> = {
                server: "myServer",
                database: "dbName",
                user: "testUser",
                authenticationType: "SqlLogin",
                connectTimeout: "15",
                trustServerCertificate: "true",
            };

            await mssqlProtocolHandler.handleUri(
                Uri.parse(
                    `vscode://ms-mssql.mssql/openConnectionDialog?${new URLSearchParams(params).toString()}`,
                ),
            );

            expect(openConnectionDialogStub).to.have.been.calledOnceWith({
                ...params,
                // savePassword is auto-added, and non-string values are converted
                savePassword: true,
                connectTimeout: 15,
                trustServerCertificate: true,
            });
            expect(connectProfileStub).to.not.have.been.called;
        });
    });

    suite("readProfileFromArgs", () => {
        test("Should include connection properties that aren't sourced from SQL Tools Service", async () => {
            const profileName = "myProfile";

            const connInfo = await mssqlProtocolHandler["readProfileFromArgs"](
                `server=${testServer}&database=${testDatabase}&accountId=${accountId}&tenantId=${tenantId}&profileName=${profileName}`,
            );

            expect(connInfo).to.be.an("object");
            expect(connInfo.server).to.equal(testServer);
            expect(connInfo.database).to.equal(testDatabase);
            expect(connInfo.profileName).to.equal(profileName);
            expect(connInfo.accountId).to.equal(accountId);
            expect(connInfo.tenantId).to.equal(tenantId);
        });

        test("Should ignore invalid values for booleans and numbers", async () => {
            const connInfo = await mssqlProtocolHandler["readProfileFromArgs"](
                `server=${testServer}&database=${testDatabase}&trustServerCertificate=yes&connectTimeout=twenty`,
            );

            expect(connInfo).to.be.an("object");
            expect(connInfo.server).to.equal(testServer);
            expect(connInfo.database).to.equal(testDatabase);
            expect(
                connInfo.trustServerCertificate,
                "trustServerCertificate should be false from an invalid value",
            ).to.be.false;
            expect(
                connInfo.connectTimeout,
                "connectTimeout should be undefined from an invalid value",
            ).to.be.undefined;
        });

        test("Should handle invalid parameter by ignoring it", async () => {
            const madeUpParam = "madeUpParam";
            const connInfo = await mssqlProtocolHandler["readProfileFromArgs"](
                `server=${testServer}&database=${testDatabase}&${madeUpParam}=great`,
            );

            expect(connInfo).to.be.an("object");
            expect(connInfo.server).to.equal(testServer);
            expect(connInfo.database).to.equal(testDatabase);
            expect(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (connInfo as any)[madeUpParam],
                `${madeUpParam} should be undefined from an invalid value`,
            ).to.be.undefined;
        });
    });
});
