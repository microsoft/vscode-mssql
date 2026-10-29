/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { IConnectionInfo, SimpleExecuteResult } from "vscode-mssql";

import {
    getAzureArcRegistration,
    parseAzureArcRegistration,
} from "../../src/integration/azureArcSqlServer";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";

chai.use(sinonChai);

/** Builds the row the Arc registration query returns; undefined cells are SQL NULLs. */
const buildResult = (...values: (string | undefined)[]): SimpleExecuteResult => ({
    rowCount: 1,
    columnInfo: [],
    rows: [values.map((value) => ({ displayValue: value ?? "NULL", isNull: value === undefined }))],
});

suite("Azure Arc SQL Server", () => {
    suite("parseAzureArcRegistration", () => {
        test("finds the instance's resource ID in the Arc properties, whatever the columns", () => {
            const arcProperties =
                '<row Version="1.1" Id="/subscriptions/sub-1/resourceGroups/Arc-RG/providers/Microsoft.AzureArcData/sqlServerInstances/HOST_SQLEXPRESS" />';

            expect(
                parseAzureArcRegistration(buildResult("HOST", "1", "1", arcProperties)),
            ).to.deep.equal({
                status: "registered",
                instance: {
                    resourceId:
                        "/subscriptions/sub-1/resourceGroups/Arc-RG/providers/Microsoft.AzureArcData/sqlServerInstances/HOST_SQLEXPRESS",
                    subscriptionId: "sub-1",
                    resourceGroupName: "Arc-RG",
                    name: "HOST_SQLEXPRESS",
                },
            });
        });

        test("reports no registration when the login could have seen the Arc table", () => {
            expect(
                parseAzureArcRegistration(buildResult("HOST", "0", "1", undefined)),
            ).to.deep.equal({ status: "notRegistered" });
        });

        test("can't tell when the login can't see msdb's metadata", () => {
            expect(
                parseAzureArcRegistration(buildResult("HOST", "0", "0", undefined)),
            ).to.deep.equal({ status: "unknown", machineName: "HOST" });
        });

        test("can't tell when the Arc table can't be read", () => {
            expect(
                parseAzureArcRegistration(buildResult("HOST", "1", "1", undefined)),
            ).to.deep.equal({ status: "unknown", machineName: "HOST" });
        });

        test("can't tell from an empty result", () => {
            expect(
                parseAzureArcRegistration({ rowCount: 0, columnInfo: [], rows: [] }),
            ).to.deep.equal({ status: "unknown", machineName: undefined });
        });
    });

    suite("getAzureArcRegistration", () => {
        let sandbox: sinon.SinonSandbox;
        let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
        let sqlToolsClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
        const connection = { server: "sqlprod01", database: "Sales" } as IConnectionInfo;

        setup(() => {
            sandbox = sinon.createSandbox();
            connectionManager = sandbox.createStubInstance(ConnectionManager);
            sqlToolsClient = sandbox.createStubInstance(SqlToolsServiceClient);
            sandbox.stub(connectionManager, "client").get(() => sqlToolsClient);
        });

        teardown(() => {
            sandbox.restore();
        });

        test("asks over a connection of its own and closes it", async () => {
            connectionManager.connect.resolves(true);
            sqlToolsClient.sendRequest.resolves(buildResult("HOST", "0", "1", undefined));

            const registration = await getAzureArcRegistration(connectionManager, connection);

            expect(registration).to.deep.equal({ status: "notRegistered" });
            const ownerUri = connectionManager.connect.firstCall.args[0];
            expect(connectionManager.connect.firstCall.args[1]).to.deep.equal(connection);
            expect(sqlToolsClient.sendRequest.firstCall.args[1]).to.include({ ownerUri });
            expect(connectionManager.disconnect).to.have.been.calledWith(ownerUri);
        });

        test("closes the connection when the query fails", async () => {
            connectionManager.connect.resolves(true);
            sqlToolsClient.sendRequest.rejects(new Error("query failed"));

            try {
                await getAzureArcRegistration(connectionManager, connection);
                expect.fail("Expected the registration query to fail");
            } catch (error) {
                expect((error as Error).message).to.equal("query failed");
            }

            expect(connectionManager.disconnect).to.have.been.calledOnce;
        });

        test("returns undefined when the server can't be connected to", async () => {
            connectionManager.connect.resolves(false);

            expect(await getAzureArcRegistration(connectionManager, connection)).to.be.undefined;
            expect(sqlToolsClient.sendRequest).to.not.have.been.called;
            expect(connectionManager.disconnect).to.not.have.been.called;
        });
    });
});
