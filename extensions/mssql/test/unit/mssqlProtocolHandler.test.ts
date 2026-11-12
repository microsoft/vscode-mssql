/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import {
    deploymentTypesByUriType,
    getUriSource,
    MssqlProtocolHandler,
} from "../../src/mssqlProtocolHandler";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { Uri } from "vscode";
import MainController from "../../src/controllers/mainController";
import { uuid } from "../e2e/baseFixtures";
import ConnectionManager from "../../src/controllers/connectionManager";
import { MatchScore } from "../../src/models/utils";
import { IConnectionProfile } from "../../src/models/interfaces";
import { stubGetCapabilitiesRequest, stubLogger, stubTelemetry } from "./utils";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import * as vscode from "vscode";
import * as Constants from "../../src/constants/constants";
import { DeploymentType } from "../../src/sharedInterfaces/deployment";

chai.use(sinonChai);

suite("MssqlProtocolHandler Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mssqlProtocolHandler: MssqlProtocolHandler;
    let sqlToolsServiceClientMock: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let mockMainController: sinon.SinonStubbedInstance<MainController>;
    let openConnectionDialogStub: sinon.SinonStub;
    let connectProfileStub: sinon.SinonStub;
    let sendActionEventStub: sinon.SinonStub;

    const testServer = "TestServer";
    const testDatabase = "TestDatabase";
    const tenantId = "11111";
    const accountId = `00000.${tenantId}`;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubLogger(sandbox);
        sendActionEventStub = stubTelemetry(sandbox).sendActionEvent;
        mockMainController = sandbox.createStubInstance(MainController);

        sqlToolsServiceClientMock = stubGetCapabilitiesRequest(sandbox);

        mssqlProtocolHandler = new MssqlProtocolHandler(
            mockMainController,
            sqlToolsServiceClientMock,
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

        test("Should ignore unsupported connection string parameters", async () => {
            const connString = `Server=myServerAddress;Database=myDataBase;User Id=myUsername;Password=${uuid()};`;
            const mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
            sandbox.stub(mockMainController, "connectionManager").get(() => mockConnectionManager);
            mockConnectionManager.findMatchingProfile.resolves({
                profile: undefined,
                score: MatchScore.NotMatch,
            });

            await mssqlProtocolHandler.handleUri(
                Uri.parse(
                    `vscode://ms-mssql.mssql/connect?connectionString=${encodeURIComponent(connString)}`,
                ),
            );

            expect(openConnectionDialogStub).to.have.been.calledOnce;
            expect(openConnectionDialogStub.firstCall.args[0]).not.to.have.property(
                "connectionString",
            );
            expect(connectProfileStub).to.not.have.been.called;
        });

        test("Should find matching profile when parameters are provided", async () => {
            const params: Record<string, string> = {
                server: "myServer",
                database: "dbName",
                user: "testUser",
                source: "testSource",
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
                    source: "testSource",
                } as unknown as IConnectionProfile,
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

    suite("Deployment commands", () => {
        let executeCommandStub: sinon.SinonStub;

        setup(() => {
            executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();
        });

        test("Should open the Azure SQL Database wizard", async () => {
            await mssqlProtocolHandler.handleUri(
                Uri.parse("vscode://ms-mssql.mssql/deploy?type=azureSqlDatabase"),
            );

            expect(executeCommandStub).to.have.been.calledOnceWithExactly(
                Constants.cmdDeployNewDatabase,
                { deploymentType: DeploymentType.AzureSqlDatabase },
            );
            expect(openConnectionDialogStub).to.not.have.been.called;
        });

        test("Should open the SQL Server container wizard, matching the type case-insensitively", async () => {
            await mssqlProtocolHandler.handleUri(
                Uri.parse("vscode://ms-mssql.mssql/deploy?type=SQLServerContainer&source=docs"),
            );

            expect(executeCommandStub).to.have.been.calledOnceWithExactly(
                Constants.cmdDeployNewDatabase,
                { deploymentType: DeploymentType.LocalContainers },
            );
            expect(openConnectionDialogStub).to.not.have.been.called;
        });

        test("Should open the Azure SQL container wizard", async () => {
            await mssqlProtocolHandler.handleUri(
                Uri.parse("vscode://ms-mssql.mssql/deploy?type=azureSqlContainer"),
            );

            expect(executeCommandStub).to.have.been.calledOnceWithExactly(
                Constants.cmdDeployNewDatabase,
                { deploymentType: DeploymentType.AzureSqlContainer },
            );
            expect(openConnectionDialogStub).to.not.have.been.called;
        });

        const typeCases: [string, DeploymentType][] = [
            ["fabricSqlDatabase", DeploymentType.FabricProvisioning],
            ["localToCloud", DeploymentType.LocalToCloud],
        ];
        for (const [type, deploymentType] of typeCases) {
            test(`Should open the ${DeploymentType[deploymentType]} wizard for type=${type}`, async () => {
                await mssqlProtocolHandler.handleUri(
                    Uri.parse(`vscode://ms-mssql.mssql/deploy?type=${type}`),
                );

                expect(executeCommandStub).to.have.been.calledOnceWithExactly(
                    Constants.cmdDeployNewDatabase,
                    { deploymentType },
                );
            });
        }

        test("Should map every deployment type that has a wizard", () => {
            // A new DeploymentType needs a deep link name, or an entry here explaining why not.
            const typesWithoutWizard = [DeploymentType.DevContainer];
            const expected = Object.values(DeploymentType)
                .filter((value): value is DeploymentType => typeof value === "number")
                .filter((value) => !typesWithoutWizard.includes(value))
                .sort();

            expect(Object.values(deploymentTypesByUriType).sort()).to.deep.equal(expected);
        });

        test("Should open the deployment chooser when no type is given", async () => {
            await mssqlProtocolHandler.handleUri(Uri.parse("vscode://ms-mssql.mssql/deploy"));

            expect(executeCommandStub).to.have.been.calledOnceWithExactly(
                Constants.cmdDeployNewDatabase,
            );
        });

        test("Should open the deployment chooser for an unknown type", async () => {
            await mssqlProtocolHandler.handleUri(
                Uri.parse("vscode://ms-mssql.mssql/deploy?type=notAType"),
            );

            expect(executeCommandStub).to.have.been.calledOnceWithExactly(
                Constants.cmdDeployNewDatabase,
            );
        });
    });

    suite("Usage events", () => {
        setup(() => {
            sandbox.stub(vscode.commands, "executeCommand").resolves();
        });

        const expectEvent = (props: Record<string, string>) =>
            expect(sendActionEventStub).to.have.been.calledOnceWithExactly(
                TelemetryViews.ProtocolHandler,
                TelemetryActions.Invoke,
                { additionalProps: props },
            );

        test("Should record the deployment page and source", async () => {
            await mssqlProtocolHandler.handleUri(
                Uri.parse("vscode://ms-mssql.mssql/deploy?type=azureSqlDatabase&source=Docs"),
            );

            expectEvent({ action: "/deploy", source: "docs", deploymentType: "AzureSqlDatabase" });
        });

        test("Should record the chooser when no type is given", async () => {
            await mssqlProtocolHandler.handleUri(Uri.parse("vscode://ms-mssql.mssql/deploy"));

            expectEvent({ action: "/deploy", source: "unknown", deploymentType: "chooser" });
        });

        test("Should not record the raw value of an unknown type", async () => {
            await mssqlProtocolHandler.handleUri(
                Uri.parse("vscode://ms-mssql.mssql/deploy?type=someone@example.com"),
            );

            expectEvent({ action: "/deploy", source: "unknown", deploymentType: "unrecognized" });
        });

        test("Should not add deployment properties to other commands", async () => {
            await mssqlProtocolHandler.handleUri(
                Uri.parse("vscode://ms-mssql.mssql/openConnectionDialog?source=blog"),
            );

            expectEvent({ action: "/openConnectionDialog", source: "blog" });
        });
    });

    suite("getUriSource", () => {
        const sourceOf = (query: string) =>
            getUriSource(Uri.parse(`vscode://ms-mssql.mssql/deploy?${query}`));

        test("Should return unknown when source is missing or empty", () => {
            expect(sourceOf("")).to.equal("unknown");
            expect(sourceOf("source=")).to.equal("unknown");
        });

        test("Should keep and lowercase identifier-like values", () => {
            expect(sourceOf("source=Docs")).to.equal("docs");
            expect(sourceOf("source=learn.microsoft-com_2")).to.equal("learn.microsoft-com_2");
        });

        test("Should replace free text, URLs, and long values with invalid", () => {
            expect(sourceOf(`source=${encodeURIComponent("someone@example.com")}`)).to.equal(
                "invalid",
            );
            expect(sourceOf(`source=${encodeURIComponent("https://example.com/a")}`)).to.equal(
                "invalid",
            );
            expect(sourceOf("source=has%20space")).to.equal("invalid");
            expect(sourceOf(`source=${"a".repeat(65)}`)).to.equal("invalid");
            expect(sourceOf(`source=${"a".repeat(64)}`)).to.equal("a".repeat(64));
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
