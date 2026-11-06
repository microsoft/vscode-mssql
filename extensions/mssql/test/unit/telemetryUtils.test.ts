/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { IConnectionInfo } from "vscode-mssql";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { getConnectionTelemetryInfo } from "../../src/utils/telemetryUtils";

suite("Connection telemetry context", () => {
    let sandbox: sinon.SinonSandbox;
    let manager: sinon.SinonStubbedInstance<ConnectionManager>;
    const profile = {
        server: "example.database.windows.net",
        authenticationType: "AzureMFA",
    } as IConnectionInfo;
    const serverInfo = {
        serverMajorVersion: 16,
        engineEditionId: 5,
        serverMinorVersion: 0,
        serverReleaseVersion: 1000,
        serverVersion: "16.0.1000",
        serverLevel: "",
        serverEdition: "",
        isCloud: true,
        azureVersion: 12,
        osVersion: "",
        options: {},
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        manager = sandbox.createStubInstance(ConnectionManager);
        manager.getServerInfo.withArgs(profile).returns(serverInfo);
    });

    teardown(() => sandbox.restore());

    test("uses an explicit profile and cached server metadata without resolving another connection", () => {
        expect(getConnectionTelemetryInfo(manager, profile)).to.deep.equal({
            connectionInfo: profile,
            serverInfo,
        });
        sinon.assert.notCalled(manager.getConnectionInfo);
        sinon.assert.notCalled(manager.connect);
        sinon.assert.notCalled(manager.listDatabases);
    });

    test("resolves the requested owner URI rather than another editor's connection", () => {
        const uriServerInfo = {
            ...serverInfo,
            databaseServiceTier: "GeneralPurpose",
            databaseServiceObjective: "GP_Gen5_2",
        };
        manager.getConnectionInfo.withArgs("query://requested").returns(
            Object.assign(new ConnectionInfo(), {
                credentials: profile,
                serverInfo: uriServerInfo,
            }),
        );
        manager.getConnectionInfo.withArgs("query://other").returns({
            credentials: { server: "other-server", authenticationType: "SqlLogin" },
        } as ConnectionInfo);

        expect(getConnectionTelemetryInfo(manager, "query://requested")).to.deep.equal({
            connectionInfo: profile,
            serverInfo: uriServerInfo,
        });
        sinon.assert.calledWithExactly(manager.getConnectionInfo, "query://requested");
        sinon.assert.notCalled(manager.getServerInfo);
        sinon.assert.notCalled(manager.connect);
    });

    test("uses URI-owned metadata for different databases on the same saved profile", () => {
        const databaseA = { ...profile, id: "shared-profile", database: "database-a" };
        const databaseB = { ...profile, id: "shared-profile", database: "database-b" };
        const databaseBServerInfo = {
            ...serverInfo,
            databaseServiceTier: "BusinessCritical",
            databaseServiceObjective: "BC_Gen5_4",
        };
        manager.getConnectionInfo.withArgs("query://database-b").returns(
            Object.assign(new ConnectionInfo(), {
                credentials: databaseB,
                serverInfo: databaseBServerInfo,
            }),
        );
        manager.getServerInfo.withArgs(databaseB).returns({
            ...serverInfo,
            databaseServiceTier: "GeneralPurpose",
            databaseServiceObjective: "GP_Gen5_2",
        });
        manager.getServerInfo.withArgs(databaseA).returns(serverInfo);

        expect(getConnectionTelemetryInfo(manager, "query://database-b")).to.deep.equal({
            connectionInfo: databaseB,
            serverInfo: databaseBServerInfo,
        });
        sinon.assert.notCalled(manager.getServerInfo);
    });

    test("leaves an unknown owner URI without context", () => {
        expect(getConnectionTelemetryInfo(manager, "query://unknown")).to.deep.equal({
            connectionInfo: undefined,
            serverInfo: undefined,
        });
        sinon.assert.notCalled(manager.getServerInfo);
    });

    for (const targetDatabase of ["database-b", ""]) {
        test(`omits URI database metadata when target '${targetDatabase}' is not the owning database`, () => {
            const cachedServerInfo = {
                ...serverInfo,
                databaseServiceTier: "GeneralPurpose",
                databaseServiceObjective: "GP_Gen5_2",
            };
            const credentials = { ...profile, database: "database-a" };
            manager.getConnectionInfo.withArgs("query://database-a").returns(
                Object.assign(new ConnectionInfo(), {
                    credentials,
                    serverInfo: cachedServerInfo,
                }),
            );

            const context = getConnectionTelemetryInfo(
                manager,
                "query://database-a",
                targetDatabase,
            );

            expect(context.connectionInfo).to.equal(credentials);
            expect(context.serverInfo).to.include({
                engineEditionId: 5,
                databaseServiceTier: undefined,
                databaseServiceObjective: undefined,
            });
            expect(cachedServerInfo.databaseServiceTier).to.equal("GeneralPurpose");
            sinon.assert.notCalled(manager.getServerInfo);
        });
    }

    test("retains URI database metadata for the matching operation target", () => {
        const credentials = { ...profile, database: "database-a" };
        manager.getConnectionInfo
            .withArgs("query://database-a")
            .returns(Object.assign(new ConnectionInfo(), { credentials, serverInfo }));

        expect(
            getConnectionTelemetryInfo(manager, "query://database-a", "database-a").serverInfo,
        ).to.equal(serverInfo);
    });

    test("does not infer a connection when no explicit context is supplied", () => {
        expect(getConnectionTelemetryInfo(manager, undefined)).to.deep.equal({
            connectionInfo: undefined,
            serverInfo: undefined,
        });
        sinon.assert.notCalled(manager.getConnectionInfo);
        sinon.assert.notCalled(manager.getServerInfo);
    });

    test("retains an explicit profile when cached server metadata is unavailable", () => {
        manager.getServerInfo.resetBehavior();
        manager.getServerInfo.returns(undefined);
        expect(getConnectionTelemetryInfo(manager, profile)).to.deep.equal({
            connectionInfo: profile,
            serverInfo: undefined,
        });
    });

    test("is safe before an owning controller's connection manager has initialized", () => {
        expect(getConnectionTelemetryInfo(undefined, "query://requested")).to.deep.equal({
            connectionInfo: undefined,
            serverInfo: undefined,
        });
    });
});
