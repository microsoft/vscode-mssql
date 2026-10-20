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
        manager.getConnectionInfo.withArgs("query://requested").returns({
            credentials: profile,
        } as ConnectionInfo);
        manager.getConnectionInfo.withArgs("query://other").returns({
            credentials: { server: "other-server", authenticationType: "SqlLogin" },
        } as ConnectionInfo);

        expect(getConnectionTelemetryInfo(manager, "query://requested")).to.deep.equal({
            connectionInfo: profile,
            serverInfo,
        });
        sinon.assert.calledWithExactly(manager.getConnectionInfo, "query://requested");
        sinon.assert.calledWithExactly(manager.getServerInfo, profile);
        sinon.assert.notCalled(manager.connect);
    });

    test("leaves an unknown owner URI without context", () => {
        expect(getConnectionTelemetryInfo(manager, "query://unknown")).to.deep.equal({
            connectionInfo: undefined,
            serverInfo: undefined,
        });
        sinon.assert.notCalled(manager.getServerInfo);
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
