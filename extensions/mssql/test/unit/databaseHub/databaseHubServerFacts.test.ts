/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { IServerInfo } from "vscode-mssql";

import {
    DatabaseHubServerFactsDetector,
    DatabaseHubServerFactsStore,
    serverFactsQuery,
    toServerFacts,
} from "../../../src/databaseHub/databaseHubServerFacts";
import { PerformanceConnectionResolver } from "../../../src/performance/performanceConnections";
import { PerformanceSessionPool } from "../../../src/performance/performanceSessionPool";
import { createStubLogger } from "../utils";

chai.use(sinonChai);

class MemoryMemento implements vscode.Memento {
    private readonly _values = new Map<string, unknown>();
    keys(): readonly string[] {
        return [...this._values.keys()];
    }
    get<T>(key: string, defaultValue?: T): T | undefined {
        return (this._values.has(key) ? this._values.get(key) : defaultValue) as T | undefined;
    }
    update(key: string, value: unknown): Thenable<void> {
        this._values.set(key, value);
        return Promise.resolve();
    }
}

const arcId =
    "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.AzureArcData/sqlServerInstances/box01";

function summary(arcState: string, engineEdition = 3) {
    return {
        columns: [
            "EngineEdition",
            "ServerName",
            "MachineName",
            "ProductVersion",
            "Edition",
            "ArcState",
        ],
        rows: [
            [
                engineEdition,
                "BOX01",
                "box01",
                "16.0.4135.4",
                "Enterprise Edition (64-bit)",
                arcState,
            ],
        ],
    };
}

suite("Database Hub server facts", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("toServerFacts", () => {
        test("finds the Arc resource ID in the Arc table row, whatever its column", () => {
            const facts = toServerFacts(
                [
                    {
                        columns: ["Name", "Identity", "Host"],
                        rows: [
                            [
                                "box01",
                                arcId,
                                "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/box01",
                            ],
                        ],
                    },
                    summary("read"),
                ],
                { server: "box01" },
                42,
            );

            expect(facts).to.deep.equal({
                server: "box01",
                engineEdition: 3,
                logicalServerName: "BOX01",
                machineName: "box01",
                serverVersion: "16.0.4135.4",
                serverEdition: "Enterprise Edition (64-bit)",
                isCloud: false,
                arc: { state: "registered", resourceId: arcId, onAzureVm: true },
                arcCheckedAt: 42,
            });
        });

        test("builds the Arc resource ID from subscription, resource group and name", () => {
            const facts = toServerFacts(
                [
                    {
                        columns: ["SubscriptionId", "ResourceGroup", "ResourceName"],
                        rows: [["sub", "rg", "box01"]],
                    },
                    summary("read"),
                ],
                { server: "box01" },
            );

            expect(facts.arc).to.deep.equal({
                state: "registered",
                resourceId: arcId,
                onAzureVm: false,
            });
        });

        test("reads an empty or missing table as not registered", () => {
            expect(
                toServerFacts([{ columns: ["Id"], rows: [] }, summary("read")], { server: "s" })
                    .arc,
            ).to.deep.equal({ state: "notRegistered" });
            expect(toServerFacts([summary("missing")], { server: "s" }).arc).to.deep.equal({
                state: "notRegistered",
            });
        });

        test("reads an unreadable table as unknown, and skips Arc outside SQL Server", () => {
            expect(toServerFacts([summary("unknown")], { server: "s" }).arc).to.deep.equal({
                state: "unknown",
            });
            const azure = toServerFacts([summary("skipped", 5)], { server: "s" });
            expect(azure.arc).to.be.undefined;
            expect(azure.arcCheckedAt).to.be.undefined;
            expect(azure.engineEdition).to.equal(5);
            expect(azure.isCloud).to.be.true;
        });
    });

    suite("DatabaseHubServerFactsStore", () => {
        test("ignores facts read for another server", async () => {
            const store = new DatabaseHubServerFactsStore(new MemoryMemento());
            const changed = sandbox.spy();
            store.onDidChange(changed);

            await store.set("c1", { server: "Box01", engineEdition: 3 });

            expect(store.get({ id: "c1", server: "box01" })?.engineEdition).to.equal(3);
            expect(store.get({ id: "c1", server: "box02" })).to.be.undefined;
            expect(store.get({ id: "c2", server: "box01" })).to.be.undefined;
            expect(changed).to.have.been.calledWith("c1");
        });
    });

    suite("DatabaseHubServerFactsDetector", () => {
        let store: DatabaseHubServerFactsStore;
        let read: sinon.SinonStub;
        let pool: sinon.SinonStubbedInstance<PerformanceSessionPool>;
        let detector: DatabaseHubServerFactsDetector;

        setup(() => {
            store = new DatabaseHubServerFactsStore(new MemoryMemento());
            read = sandbox.stub().resolves([summary("missing")]);
            pool = sandbox.createStubInstance(PerformanceSessionPool);
            pool.availability.returns(undefined);
            pool.session.returns({ read } as never);
            const connections: PerformanceConnectionResolver = {
                resolve: sandbox.stub().resolves({ connection: {}, database: "" }),
            };
            detector = new DatabaseHubServerFactsDetector(
                store,
                connections,
                pool,
                createStubLogger(sandbox),
            );
        });

        const serverInfo = (engineEditionId: number, machineName: string) =>
            ({ engineEditionId, machineName }) as unknown as IServerInfo;

        test("saves the server info of a connection, then reads the Arc state", async () => {
            const profile = { id: "c1", server: "box01" };
            await detector.onConnected(profile, serverInfo(3, "box01"));

            expect(store.get(profile)).to.include({ engineEdition: 3, machineName: "box01" });
            await detector.ensure(profile);
            expect(read).to.have.been.calledOnceWith(serverFactsQuery);
            expect(store.get(profile)?.arc).to.deep.equal({ state: "notRegistered" });
        });

        test("marks a local server whose machine name is a container ID as a container", async () => {
            const profile = { id: "c1", server: "localhost,1433" };
            await detector.onConnected(profile, serverInfo(3, "3f2a9c1b7d4e"));

            expect(store.get(profile)?.isContainer).to.be.true;
            expect(read).to.not.have.been.called;
        });

        test("reads Azure SQL facts only when the host doesn't name the logical server", async () => {
            await detector.onConnected(
                { id: "c1", server: "srv.database.windows.net" },
                serverInfo(5, ""),
            );
            expect(read).to.not.have.been.called;

            const alias = { id: "c2", server: "orders.contoso.com" };
            await detector.onConnected(alias, serverInfo(5, ""));
            await detector.ensure(alias);
            expect(read).to.have.been.calledOnce;
        });

        test("doesn't read when the SQL data plane is off", async () => {
            pool.availability.returns({ status: "unavailable", reason: "dataPlaneDisabled" });
            const profile = { id: "c1", server: "box01" };

            expect(await detector.ensure(profile)).to.be.undefined;
            expect(read).to.not.have.been.called;
        });
    });
});
