/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { ConnectionStore } from "../../src/models/connectionStore";
import { ConnectionProfile } from "../../src/models/connectionProfile";
import { CredentialsQuickPickItemType } from "../../src/models/interfaces";
import type { IServerInfo } from "vscode-mssql";
import { DatabaseEngineEdition } from "../../src/databaseProjects/common/enums";
import { connectLocalDatabaseSource } from "../../src/deployment/localDatabaseSources";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";

chai.use(sinonChai);
const { expect } = chai;

suite("Connecting local deployment databases", () => {
    let sandbox: sinon.SinonSandbox;
    let manager: sinon.SinonStubbedInstance<ConnectionManager>;
    let store: sinon.SinonStubbedInstance<ConnectionStore>;
    let profile: ConnectionProfile;
    let connection: ConnectionInfo;
    let active: Record<string, ConnectionInfo>;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    const connectSource = () => connectLocalDatabaseSource(manager, profile.id, client);

    setup(() => {
        sandbox = sinon.createSandbox();
        manager = sandbox.createStubInstance(ConnectionManager);
        client = sandbox.createStubInstance(SqlToolsServiceClient);
        client.sendRequest.resolves({
            rowCount: 1,
            columnInfo: [],
            rows: [
                [{ displayValue: "Microsoft SQL Server 2025 (RTM) - 17.0.1000", isNull: false }],
            ],
        });
        store = sandbox.createStubInstance(ConnectionStore);
        sandbox.stub(manager, "connectionStore").get(() => store);
        active = {};
        sandbox.stub(manager, "activeConnections").get(() => active);
        profile = sandbox.createStubInstance(ConnectionProfile);
        profile.id = "local-db";
        profile.profileName = "Development";
        profile.server = "localhost,1433";
        profile.database = "InventoryDb";
        store.readAllConnections.resolves([
            Object.assign(profile, { profileSource: CredentialsQuickPickItemType.Profile }),
        ]);
        connection = new ConnectionInfo();
        connection.credentials = profile;
        connection.connectionId = "active-db";
        connection.serverInfo = {
            serverVersion: "17.0.1000",
            serverMajorVersion: 17,
            engineEditionId: DatabaseEngineEdition.Enterprise,
            isCloud: false,
        } as IServerInfo;
        manager.getConnectionInfo.returns(connection);
    });

    teardown(() => sandbox.restore());

    test("connects a saved database and returns its release year without leaking credentials", async () => {
        manager.connect.callsFake(async (_uri, credentials) => {
            credentials.password = "test-only-password";
            return true;
        });
        const result = await connectSource();

        expect(result).to.include({
            id: profile.id,
            database: "InventoryDb",
            isConnected: true,
            serverVersion: "2025",
        });
        expect(result).not.to.have.property("password");
        expect(profile.password).not.to.equal("test-only-password");
        expect(manager.connect).to.have.been.calledWith(
            sinon.match.string,
            sinon.match({ id: profile.id }),
            {
                shouldHandleErrors: false,
                connectionSource: "localToCloudDeployment",
            },
        );
        expect(client.sendRequest).to.have.been.calledWith(
            sinon.match({ method: "query/simpleexecute" }),
            sinon.match({
                ownerUri: sinon.match.string,
                queryString: "SELECT @@VERSION AS version;",
            }),
        );
    });

    test("reuses a connected database identified by its connection ID", async () => {
        active.existing = connection;
        manager.isConnected.withArgs("existing").returns(true);

        const result = await connectSource();

        expect(result.isConnected).to.equal(true);
        expect(result.serverVersion).to.equal("2025");
        expect(manager.connect).not.to.have.been.called;
        expect(client.sendRequest).to.have.been.calledWith(sinon.match.any, {
            ownerUri: "existing",
            queryString: "SELECT @@VERSION AS version;",
        });
    });

    test("rejects a failed connection instead of returning a stale version", async () => {
        manager.connect.resolves(false);
        let failure: unknown;
        try {
            await connectSource();
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.instanceOf(Error);
        expect(failure).to.have.property(
            "message",
            "Unable to connect to the selected local database.",
        );
    });

    test("propagates credential or connection errors", async () => {
        const failure = new Error("Credential lookup failed");
        manager.connect.rejects(failure);
        let actual: unknown;
        try {
            await connectSource();
        } catch (error) {
            actual = error;
        }
        expect(actual).to.equal(failure);
    });

    test("does not connect an unknown ID", async () => {
        store.readAllConnections.resolves([]);
        let failure: unknown;
        try {
            await connectSource();
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.instanceOf(Error);
        expect(manager.connect).not.to.have.been.called;
    });

    test("does not connect a remote profile", async () => {
        profile.server = "remote.database.windows.net";
        let failure: unknown;
        try {
            await connectSource();
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.instanceOf(Error);
        expect(manager.connect).not.to.have.been.called;
    });

    test("extracts the release year from the query rather than a major-version mapping", async () => {
        manager.connect.resolves(true);
        client.sendRequest.resolves({
            rows: [
                [
                    {
                        displayValue:
                            "Microsoft SQL Server 2022 (RTM-CU) - 16.0.1234\nDeveloper Edition",
                        isNull: false,
                    },
                ],
            ],
        });
        expect((await connectSource()).serverVersion).to.equal("2022");
    });

    test("keeps the actual Azure SQL container build instead of labeling it SQL Server 2014", async () => {
        connection.serverInfo = {
            ...connection.serverInfo!,
            serverVersion: "12.0.2000.8",
            serverMajorVersion: 12,
            engineEditionId: -978196525,
        };
        manager.connect.resolves(true);

        expect(await connectSource()).to.include({
            serverVersion: "12.0.2000.8",
            isAzureSql: true,
        });
        active.existing = connection;
        manager.isConnected.withArgs("existing").returns(true);
        expect(await connectSource()).to.include({
            serverVersion: "12.0.2000.8",
            isAzureSql: true,
        });
        expect(client.sendRequest).not.to.have.been.called;
    });

    test("rejects missing, unexpected and error query results instead of guessing a year", async () => {
        manager.connect.resolves(true);
        for (const result of [
            { rows: [] },
            { rows: [[{ displayValue: "17.0.1000", isNull: false }]] },
            { rows: [[{ displayValue: "Microsoft SQL Server 2025", isNull: true }]] },
            {
                rows: [[{ displayValue: "Microsoft SQL Server 2025", isNull: false }]],
                messages: [{ isError: true, message: "Query failed" }],
            },
        ]) {
            client.sendRequest.resolves(result);
            let failure: unknown;
            try {
                await connectSource();
            } catch (error) {
                failure = error;
            }
            expect(failure).to.have.property(
                "message",
                "Unable to determine the selected SQL Server release year.",
            );
        }
    });

    test("propagates a version-query failure", async () => {
        manager.connect.resolves(true);
        const failure = new Error("Version query failed");
        client.sendRequest.rejects(failure);
        let actual: unknown;
        try {
            await connectSource();
        } catch (error) {
            actual = error;
        }
        expect(actual).to.equal(failure);
    });
});
