/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from "net";
import * as fs from "fs";
import * as sinon from "sinon";
import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import {
    createMessageConnection,
    ResponseError,
    StreamMessageReader,
    StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { Logger } from "../../../src/models/logger";
import {
    BridgeErrorCode,
    sqlToolsMcpBridgeProtocolVersion,
} from "../../../src/sqlToolsMcp/contracts";
import {
    BridgeLifecycleState,
    SqlToolsMcpBridgeManager,
} from "../../../src/sqlToolsMcp/sqlToolsMcpBridgeManager";
import { SqlToolsMcpRuntime } from "../../../src/sqlToolsMcp/sqlToolsMcpRuntime";

chai.use(sinonChai);

suite("SQL Tools MCP bridge manager", () => {
    let sandbox: sinon.SinonSandbox;
    let runtime: sinon.SinonStubbedInstance<SqlToolsMcpRuntime>;
    let logger: sinon.SinonStubbedInstance<Logger>;
    let manager: SqlToolsMcpBridgeManager;

    setup(() => {
        sandbox = sinon.createSandbox();
        runtime = sandbox.createStubInstance(SqlToolsMcpRuntime);
        runtime.dispose.resolves();
        runtime.isAvailable.resolves({ isAvailable: true });
        logger = sandbox.createStubInstance(Logger);
        manager = new SqlToolsMcpBridgeManager(runtime, logger, "1.2.3");
    });

    teardown(() => {
        manager.dispose();
        sandbox.restore();
    });

    test("moves from listening to ready after bridge initialize", async () => {
        const launchInfo = await manager.prepareLaunch();
        const client = await connectToBridge(launchInfo.endpoint);

        const pingBeforeInitialize = await client.connection.sendRequest<{ ready: boolean }>(
            "ping",
        );
        const initializeResult = await client.connection.sendRequest<{
            protocolVersion: string;
            hostIdentity: { name: string; version?: string };
        }>("initialize", {
            protocolVersion: sqlToolsMcpBridgeProtocolVersion,
            serverIdentity: {
                name: "SQLtoolsMCPserver",
                version: "2.0.24",
            },
        });
        const health = await client.connection.sendRequest<{
            ready: boolean;
            state: BridgeLifecycleState;
        }>("health");
        const availability = await client.connection.sendRequest<{ isAvailable: boolean }>(
            "vscode/isAvailable",
        );

        expect(launchInfo.generation).to.equal(1);
        expect(manager.lifecycleState).to.equal(BridgeLifecycleState.Ready);
        expect(pingBeforeInitialize).to.deep.equal({ ready: false });
        expect(initializeResult).to.deep.equal({
            protocolVersion: sqlToolsMcpBridgeProtocolVersion,
            hostIdentity: {
                name: "vscode-mssql",
                version: "1.2.3",
            },
        });
        expect(health).to.deep.equal({
            ready: true,
            state: BridgeLifecycleState.Ready,
        });
        expect(availability).to.deep.equal({ isAvailable: true });
        expect(runtime.isAvailable).to.have.been.called;

        client.dispose();
    });

    test("rejects runtime requests before initialize", async () => {
        const launchInfo = await manager.prepareLaunch();
        const client = await connectToBridge(launchInfo.endpoint);

        const error = await expectResponseError(() =>
            client.connection.sendRequest("vscode/isAvailable"),
        );

        expect(error.data).to.deep.equal({
            errorCode: BridgeErrorCode.NotReady,
            retryable: true,
        });
        expect(runtime.isAvailable).not.to.have.been.called;

        client.dispose();
    });

    test("rejects incompatible protocol versions", async () => {
        const launchInfo = await manager.prepareLaunch();
        const client = await connectToBridge(launchInfo.endpoint);

        const error = await expectResponseError(() =>
            client.connection.sendRequest("initialize", {
                protocolVersion: "2.0",
            }),
        );

        expect(error.data).to.deep.equal({
            errorCode: BridgeErrorCode.ProtocolMismatch,
            retryable: false,
        });
        expect(manager.lifecycleState).to.equal(BridgeLifecycleState.Connected);

        client.dispose();
    });

    test("resets previous launch state and increments generation", async () => {
        const firstLaunch = await manager.prepareLaunch();
        const secondLaunch = await manager.prepareLaunch();

        expect(secondLaunch.generation).to.equal(firstLaunch.generation + 1);
        expect(secondLaunch.endpoint).not.to.equal(firstLaunch.endpoint);
        expect(runtime.dispose).to.have.been.called;
        expect(manager.lifecycleState).to.equal(BridgeLifecycleState.Listening);
    });

    test("logs a warning when socket directory cleanup fails", async () => {
        await manager.prepareLaunch();
        const rmSyncStub = sandbox.stub(fs, "rmSync").throws(new Error("cleanup failed"));

        await manager.prepareLaunch();

        expect(logger.warn).to.have.been.calledWith("SQL Tools MCP bridge socket cleanup failed.");
        rmSyncStub.restore();
    });

    async function connectToBridge(endpoint: string): Promise<{
        connection: ReturnType<typeof createMessageConnection>;
        dispose: () => void;
    }> {
        const socket = net.createConnection(endpoint);
        await new Promise<void>((resolve, reject) => {
            socket.once("connect", resolve);
            socket.once("error", reject);
        });

        const connection = createMessageConnection(
            new StreamMessageReader(socket),
            new StreamMessageWriter(socket),
        );
        connection.listen();
        return {
            connection,
            dispose: () => {
                connection.dispose();
                socket.destroy();
            },
        };
    }

    async function expectResponseError(callback: () => Promise<unknown>): Promise<ResponseError> {
        try {
            await callback();
            expect.fail("Expected bridge request to fail");
        } catch (err) {
            expect(err).to.be.instanceOf(ResponseError);
            return err as ResponseError;
        }
    }
});
