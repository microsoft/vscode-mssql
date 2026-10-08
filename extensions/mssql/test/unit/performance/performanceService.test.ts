/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { IConnectionInfo } from "vscode-mssql";
import ConnectionManager, { ConnectionInfo } from "../../../src/controllers/connectionManager";
import { ConnectionStore } from "../../../src/models/connectionStore";
import { DataPlaneErrorCodes } from "../../../src/services/sqlDataPlane/api";
import { PerformanceService, PerformanceTarget } from "../../../src/performance/performanceService";
import {
    PerformanceSessionPool,
    unavailable,
} from "../../../src/performance/performanceSessionPool";
import {
    ConnectionManagerPerformanceResolver,
    PerformanceConnectionResolver,
} from "../../../src/performance/performanceConnections";
import { isPerformanceUnavailable } from "../../../src/sharedInterfaces/performance";
import { FakeConnectionService, QueryScript, fakeHost, testConnection } from "./dataPlaneFakes";

chai.use(sinonChai);

const azureSqlDatabase: QueryScript = {
    resultSets: [
        {
            columns: ["engine_edition", "product_version", "data_lake_log_publishing"],
            values: [[5, "12.0.2000.8", undefined]],
            typeHints: ["number", "string", "string"],
        },
    ],
};

function activityScript(statementText: unknown): QueryScript {
    return {
        resultSets: [
            { columns: ["has_permission"], values: [[1]], typeHints: ["number"] },
            {
                columns: ["session_id", "request_id", "status", "elapsed_ms", "statement_text"],
                values: [["55", "0", "running", 1200, statementText]],
                typeHints: ["string", "string", "string", "number", "string"],
            },
            { columns: ["session_id"], values: [] },
        ],
    };
}

function isPlatformQuery(text: string): boolean {
    return text.includes("SERVERPROPERTY('EngineEdition')");
}

suite("Performance service", () => {
    let sandbox: sinon.SinonSandbox;
    let dataPlane: FakeConnectionService;
    let resolver: { resolve: sinon.SinonStub };
    let performance: PerformanceService;
    let statementText: unknown;

    setup(() => {
        sandbox = sinon.createSandbox();
        statementText = "SELECT * FROM dbo.Orders";
        dataPlane = new FakeConnectionService((text) =>
            isPlatformQuery(text) ? azureSqlDatabase : activityScript(statementText),
        );
        resolver = {
            resolve: sandbox.stub().resolves({ connection: testConnection(), database: "AppDb" }),
        };
        performance = new PerformanceService(
            resolver as PerformanceConnectionResolver,
            new PerformanceSessionPool(fakeHost(dataPlane)),
        );
    });

    teardown(() => {
        performance.dispose();
        sandbox.restore();
    });

    async function resolveTarget(database?: string): Promise<PerformanceTarget> {
        const target = await performance.resolveTarget({ ownerUri: "query://1", database });
        expect(isPerformanceUnavailable(target), JSON.stringify(target)).to.equal(false);
        return target as PerformanceTarget;
    }

    function platformQueryCount(): number {
        return dataPlane.sessions
            .flatMap((session) => session.queries)
            .filter((query) => isPlatformQuery(query.text)).length;
    }

    suite("resolveTarget", () => {
        test("reports a disabled data plane without resolving the connection", async () => {
            const disabled = new PerformanceService(
                resolver as PerformanceConnectionResolver,
                new PerformanceSessionPool(fakeHost(dataPlane, { isEnabled: () => false })),
            );

            const result = await disabled.resolveTarget({ ownerUri: "query://1" });

            expect(result).to.deep.include({ status: "unavailable", reason: "dataPlaneDisabled" });
            expect(resolver.resolve).to.not.have.been.called;
            expect(dataPlane.openParams).to.have.length(0);
        });

        test("returns the resolver's unavailability", async () => {
            resolver.resolve.resolves(unavailable("connectionNotFound"));

            const result = await performance.resolveTarget({ profileId: "missing" });

            expect(result).to.deep.equal({ status: "unavailable", reason: "connectionNotFound" });
        });

        test("reports a session that does not open", async () => {
            dataPlane.openError = new Error("A network-related error occurred.");

            const result = await performance.resolveTarget({ ownerUri: "query://1" });

            expect(result).to.deep.equal({
                status: "unavailable",
                reason: "connectionFailed",
                detail: "A network-related error occurred.",
            });
        });

        test("opens the monitoring session on the requested database", async () => {
            const target = await resolveTarget("Sales");

            expect(target.database).to.equal("Sales");
            expect(dataPlane.openParams[0].database).to.equal("Sales");
            expect(dataPlane.openParams[0].applicationName).to.equal("vscode-mssql-performance");
        });

        test("uses the connection's database when the reference has none", async () => {
            const target = await resolveTarget();

            expect(target.database).to.equal("AppDb");
        });
    });

    suite("platform", () => {
        test("detects the platform once for each connection and database", async () => {
            const first = await resolveTarget();
            const second = await resolveTarget();

            const platforms = await Promise.all([
                first.platform(),
                second.platform(),
                first.platform(),
            ]);

            expect(platforms[0]).to.deep.equal({ platform: "azureSqlDatabase", engineEdition: 5 });
            expect(platforms[1]).to.equal(platforms[0]);
            expect(platformQueryCount()).to.equal(1);
            expect(dataPlane.sessions).to.have.length(1);
        });

        test("detects the platform again after a failed detection", async () => {
            let failNext = true;
            dataPlane.respond = (text) => {
                if (isPlatformQuery(text) && failNext) {
                    failNext = false;
                    return { status: "connectionLost" };
                }
                return isPlatformQuery(text) ? azureSqlDatabase : activityScript(statementText);
            };
            const target = await resolveTarget();

            let failure: unknown;
            try {
                await target.platform();
            } catch (error) {
                failure = error;
            }

            expect(failure).to.be.instanceOf(Error);
            expect((await target.platform()).platform).to.equal("azureSqlDatabase");
            expect(platformQueryCount()).to.equal(2);
        });
    });

    suite("activeRequests", () => {
        test("reads active requests through sql-core as plain JSON", async () => {
            const target = await resolveTarget();

            const result = await target.activeRequests({ timeoutMs: 5_000 });

            expect(result.status).to.equal("ready");
            expect(result.platform).to.equal("azureSqlDatabase");
            expect(result.scope).to.equal("database");
            expect(result.data?.requests.map((request) => request.sessionId)).to.deep.equal(["55"]);
            expect(result.data?.requests[0].statementText).to.equal("SELECT * FROM dbo.Orders");
            expect(result).to.not.have.property("truncated");
            const json = JSON.parse(JSON.stringify(result));
            expect(json.status).to.equal("ready");
            expect(json.data.requests[0].elapsedMs).to.equal(1200);
            const activityQuery = dataPlane.lastSession.queries.find(
                (query) => !isPlatformQuery(query.text),
            );
            expect(activityQuery?.options.timeoutMs).to.be.at.most(5_000);
        });

        test("reports statement text that the data plane shortened", async () => {
            statementText = { $t: "truncated", of: "string", bytes: 9_000, v: "SELECT TOP" };
            const target = await resolveTarget();

            const result = await target.activeRequests();

            expect(result.data?.requests[0].statementText).to.equal("SELECT TOP");
            expect(result.truncated).to.deep.equal([
                {
                    resultSet: 1,
                    row: 0,
                    column: "statement_text",
                    returnedLength: "SELECT TOP".length,
                    originalBytes: 9_000,
                    reason: "maxCellBytes",
                },
            ]);
        });

        test("returns an error result when the platform cannot be detected", async () => {
            dataPlane.respond = (text) =>
                isPlatformQuery(text)
                    ? {
                          status: "failed",
                          messages: [
                              {
                                  kind: "error",
                                  text: "VIEW SERVER STATE permission was denied.",
                                  number: 300,
                              },
                          ],
                          error: {
                              code: DataPlaneErrorCodes.queryFailed,
                              message: "query failed",
                              retryable: false,
                          },
                      }
                    : activityScript(statementText);
            const target = await resolveTarget();

            const result = await target.activeRequests();

            expect(result.status).to.equal("permissionMissing");
            expect(result.platform).to.equal("unknown");
            expect(result.error).to.deep.equal({
                message: "VIEW SERVER STATE permission was denied.",
                errorNumber: 300,
            });
        });

        test("runs a provider on the change session when asked", async () => {
            const target = await resolveTarget();

            const result = await target.run("change", async (reader, info) => {
                await reader.read("EXEC sys.sp_query_store_force_plan 1, 1;");
                return {
                    status: "ready",
                    platform: info.platform,
                    observedAtUtc: new Date(0).toISOString(),
                    missing: [],
                };
            });

            expect(result.status).to.equal("ready");
            expect(dataPlane.sessions).to.have.length(2);
            expect(dataPlane.sessions[1].queries[0].text).to.contain("force_plan");
        });
    });

    test("dispose closes the sessions and reports the service as unavailable", async () => {
        await resolveTarget();

        performance.dispose();

        expect(dataPlane.lastSession.disposeCount).to.equal(1);
        expect(performance.availability()?.reason).to.equal("dataPlaneUnavailable");
    });
});

suite("Performance connection resolver", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let connectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
    let getConnectionById: sinon.SinonStub;
    let usesMsal: boolean;
    let resolver: ConnectionManagerPerformanceResolver;

    setup(() => {
        sandbox = sinon.createSandbox();
        connectionManager = sandbox.createStubInstance(ConnectionManager);
        connectionStore = sandbox.createStubInstance(ConnectionStore);
        getConnectionById = sandbox.stub().resolves(undefined);
        sandbox
            .stub(connectionStore, "connectionConfig")
            .get(() => ({ getConnectionById }) as unknown as ConnectionStore["connectionConfig"]);
        sandbox
            .stub(connectionManager, "connectionStore")
            .get(() => connectionStore as unknown as ConnectionManager["connectionStore"]);
        usesMsal = false;
        resolver = new ConnectionManagerPerformanceResolver(
            connectionManager as unknown as ConnectionManager,
            { acquireSqlAccessToken: async () => "entra-token" },
            () => usesMsal,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    function activeConnection(credentials: Partial<IConnectionInfo>): ConnectionInfo {
        const info = new ConnectionInfo();
        info.credentials = credentials as IConnectionInfo;
        return info;
    }

    test("resolves an active connection by owner URI with its password", async () => {
        connectionManager.getConnectionInfo.withArgs("query://1").returns(
            activeConnection({
                server: "perf-server",
                database: "Sales",
                user: "sa",
                password: "in-memory",
                authenticationType: "SqlLogin",
            }),
        );

        const result = await resolver.resolve({ ownerUri: "query://1" });

        expect(isPerformanceUnavailable(result)).to.equal(false);
        if (isPerformanceUnavailable(result)) {
            return;
        }
        expect(result.database).to.equal("Sales");
        expect(result.connection.profileRef.server).to.equal("perf-server");
        expect(await result.connection.auth.passwordProvider?.()).to.equal("in-memory");
        expect(connectionStore.lookupPassword).to.not.have.been.called;
    });

    test("resolves a saved profile by ID and reads its password from the credential store", async () => {
        getConnectionById.withArgs("profile-1").resolves({
            id: "profile-1",
            server: "perf-server",
            user: "sa",
            authenticationType: "SqlLogin",
        });
        connectionStore.lookupPassword.resolves("stored");

        const result = await resolver.resolve({ profileId: "profile-1" });

        if (isPerformanceUnavailable(result)) {
            expect.fail(JSON.stringify(result));
        }
        expect(result.database).to.equal("");
        expect(await result.connection.auth.passwordProvider?.()).to.equal("stored");
    });

    test("reports a connection that is not found", async () => {
        expect(await resolver.resolve({ ownerUri: "query://missing" })).to.deep.equal({
            status: "unavailable",
            reason: "connectionNotFound",
        });
        expect(await resolver.resolve({ profileId: "missing" })).to.deep.equal({
            status: "unavailable",
            reason: "connectionNotFound",
        });
    });

    test("reports authentication that the data plane does not support", async () => {
        connectionManager.getConnectionInfo
            .withArgs("query://password")
            .returns(
                activeConnection({ server: "s", authenticationType: "ActiveDirectoryPassword" }),
            );
        connectionManager.getConnectionInfo
            .withArgs("query://entra")
            .returns(
                activeConnection({ server: "s", authenticationType: "AzureMFA", accountId: "a" }),
            );

        expect(
            (await resolver.resolve({ ownerUri: "query://password" })) as { reason: string },
        ).to.deep.include({ reason: "authenticationUnsupported" });

        usesMsal = true;
        expect(
            (await resolver.resolve({ ownerUri: "query://entra" })) as { reason: string },
        ).to.deep.include({ reason: "authenticationUnsupported" });

        usesMsal = false;
        const entra = await resolver.resolve({ ownerUri: "query://entra" });
        if (isPerformanceUnavailable(entra)) {
            expect.fail(JSON.stringify(entra));
        }
        expect(await entra.connection.auth.tokenProvider?.()).to.equal("entra-token");
    });
});
