/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import {
    ConnectTool,
    ConnectToolParams,
    ConnectToolResult,
} from "../../src/copilot/tools/connectTool";
import ConnectionManager from "../../src/controllers/connectionManager";
import { ConnectionStore } from "../../src/models/connectionStore";
import { IConnectionProfileWithSource } from "../../src/models/interfaces";

chai.use(sinonChai);

suite("ConnectTool Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let connectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
    let connectTool: ConnectTool;

    const token = {} as vscode.CancellationToken;

    function createProfile(
        id: string,
        overrides: Partial<IConnectionProfileWithSource> = {},
    ): IConnectionProfileWithSource {
        return {
            id,
            profileName: `Profile ${id}`,
            server: `server-${id}`,
            database: `db-${id}`,
            ...overrides,
        } as IConnectionProfileWithSource;
    }

    async function connect(input: ConnectToolParams): Promise<ConnectToolResult> {
        const result = await connectTool.call(
            { input } as vscode.LanguageModelToolInvocationOptions<ConnectToolParams>,
            token,
        );
        return JSON.parse(result) as ConnectToolResult;
    }

    setup(() => {
        sandbox = sinon.createSandbox();

        connectionManager = sandbox.createStubInstance(ConnectionManager);
        connectionStore = sandbox.createStubInstance(ConnectionStore);
        sandbox.stub(connectionManager, "connectionStore").get(() => connectionStore);
        connectionManager.handlePasswordBasedCredentials.resolves(true);
        connectionManager.connect.resolves(true);

        connectTool = new ConnectTool(connectionManager);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("connects to a profile that does not restrict agent access", async () => {
        connectionStore.readAllConnections.resolves([createProfile("a")]);

        const result = await connect({ profileId: "a" });

        expect(result.success).to.be.true;
        expect(connectionManager.connect).to.have.been.calledOnce;
    });

    test("connects to a profile where allowAgentAccess is true", async () => {
        connectionStore.readAllConnections.resolves([
            createProfile("a", { allowAgentAccess: true }),
        ]);

        const result = await connect({ profileId: "a" });

        expect(result.success).to.be.true;
    });

    test("refuses to connect by profileId when allowAgentAccess is false", async () => {
        connectionStore.readAllConnections.resolves([
            createProfile("hidden", { allowAgentAccess: false }),
        ]);

        const result = await connect({ profileId: "hidden" });

        expect(result.success).to.be.false;
        expect(connectionManager.connect).to.not.have.been.called;
        expect(connectionManager.handlePasswordBasedCredentials).to.not.have.been.called;
    });

    test("refuses to connect by server and database when allowAgentAccess is false", async () => {
        connectionStore.readAllConnections.resolves([
            createProfile("hidden", { allowAgentAccess: false }),
        ]);

        const result = await connect({ serverName: "server-hidden", database: "db-hidden" });

        expect(result.success).to.be.false;
        expect(connectionManager.connect).to.not.have.been.called;
    });

    test("reports a hidden profile the same way as one that does not exist", async () => {
        connectionStore.readAllConnections.resolves([
            createProfile("hidden", { allowAgentAccess: false }),
        ]);

        const hidden = await connect({ profileId: "hidden" });
        const missing = await connect({ profileId: "does-not-exist" });

        // Only the id echoed back in the message may differ
        expect(hidden.message).to.include("hidden");
        expect(hidden.message?.replace("hidden", "<id>")).to.equal(
            missing.message?.replace("does-not-exist", "<id>"),
        );
    });

    test("falls back to an accessible profile that shares a server with a hidden one", async () => {
        connectionStore.readAllConnections.resolves([
            createProfile("hidden", {
                allowAgentAccess: false,
                server: "shared-server",
                database: "secret-db",
            }),
            createProfile("open", { server: "shared-server", database: "open-db" }),
        ]);

        const result = await connect({ serverName: "shared-server" });

        expect(result.success).to.be.true;
        expect(connectionManager.connect).to.have.been.calledOnce;
        const connectedProfile = connectionManager.connect.firstCall.args[1];
        expect(connectedProfile.database).to.equal("open-db");
    });
});
