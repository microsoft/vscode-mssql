/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import { ListServersResult, ListServersTool } from "../../src/copilot/tools/listServersTool";
import ConnectionManager from "../../src/controllers/connectionManager";
import { ConnectionStore } from "../../src/models/connectionStore";
import { IConnectionProfileWithSource } from "../../src/models/interfaces";

suite("ListServersTool Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
    let listServersTool: ListServersTool;

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

    async function listServers(): Promise<ListServersResult> {
        const result = await listServersTool.call(
            { input: undefined } as vscode.LanguageModelToolInvocationOptions<undefined>,
            token,
        );
        return JSON.parse(result) as ListServersResult;
    }

    setup(() => {
        sandbox = sinon.createSandbox();

        const connectionManager = sandbox.createStubInstance(ConnectionManager);
        connectionStore = sandbox.createStubInstance(ConnectionStore);
        sandbox.stub(connectionManager, "connectionStore").get(() => connectionStore);

        listServersTool = new ListServersTool(connectionManager);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("returns all saved profiles when none restrict agent access", async () => {
        connectionStore.readAllConnections.resolves([
            createProfile("a"),
            createProfile("b", { allowAgentAccess: true }),
        ]);

        const { servers } = await listServers();

        expect(servers.map((s) => s.profileId)).to.deep.equal(["a", "b"]);
    });

    test("leaves out profiles where allowAgentAccess is false", async () => {
        connectionStore.readAllConnections.resolves([
            createProfile("a"),
            createProfile("hidden", { allowAgentAccess: false }),
            createProfile("c"),
        ]);

        const { servers } = await listServers();

        expect(servers.map((s) => s.profileId)).to.deep.equal(["a", "c"]);
    });

    test("does not reveal any details of a hidden profile", async () => {
        connectionStore.readAllConnections.resolves([
            createProfile("hidden", {
                allowAgentAccess: false,
                profileName: "Production HR",
                server: "prod-hr.example.com",
            }),
        ]);

        const result = await listServersTool.call(
            { input: undefined } as vscode.LanguageModelToolInvocationOptions<undefined>,
            token,
        );

        expect(JSON.parse(result).servers).to.be.empty;
        expect(result).to.not.include("Production HR");
        expect(result).to.not.include("prod-hr.example.com");
    });
});
