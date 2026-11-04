/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { SqlReadError, SqlResultSet } from "sql-core";
import { PerformanceConnectionResolver } from "../../../src/performance/performanceConnections";
import {
    PerformanceSession,
    PerformanceSessionPool,
    unavailable,
} from "../../../src/performance/performanceSessionPool";
import { QueryStoreService } from "../../../src/performance/queryStoreService";
import { PreparedConnection } from "../../../src/services/metadata/profileAuthAdapter";

chai.use(sinonChai);

/** The batches of the capabilities read: SQL Server 2022, then the column probe. */
const capabilityBatches: SqlResultSet[][] = [
    [{ columns: ["engine_edition", "product_version"], rows: [[3, "16.0.4135.4"]] }],
    [
        {
            columns: [
                "has_log_bytes",
                "has_tempdb",
                "has_replica_groups",
                "has_plan_forcing_type",
                "has_plan_type",
                "has_capture_policy",
                "has_wait_stats_capture",
            ],
            rows: [[1, 1, 0, 1, 1, 1, 1]],
        },
    ],
];

suite("QueryStoreService", () => {
    let sandbox: sinon.SinonSandbox;
    let pool: sinon.SinonStubbedInstance<PerformanceSessionPool>;
    let resolver: { resolve: sinon.SinonStub };
    let sessions: Map<string, PerformanceSession & { read: sinon.SinonStub }>;
    let service: QueryStoreService;
    const connection = { serverFingerprint: "server-1" } as PreparedConnection;

    function fakeSession(): PerformanceSession & { read: sinon.SinonStub } {
        // Each capabilities read gets the platform batch, then the column probe.
        let batch = 0;
        return {
            database: "Sales",
            purpose: "read",
            generation: 1,
            ensureOpen: sandbox.stub().resolves(undefined),
            read: sandbox
                .stub()
                .callsFake(async () => capabilityBatches[batch++ % capabilityBatches.length]),
        };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        sessions = new Map();
        pool = sandbox.createStubInstance(PerformanceSessionPool);
        pool.availability.returns(undefined);
        pool.session.callsFake((_connection, database, purpose) => {
            const key = `${database}:${purpose}`;
            if (!sessions.has(key)) {
                sessions.set(key, fakeSession());
            }
            return sessions.get(key)!;
        });
        resolver = {
            resolve: sandbox.stub().resolves({ connection, database: "Sales" }),
        };
        service = new QueryStoreService(resolver as PerformanceConnectionResolver, pool);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("runs an operation on the profile's database with its capabilities", async () => {
        const operation = sandbox.stub().resolves({ status: "ready", data: 42 });

        const result = await service.run("profile-1", undefined, operation);

        expect(result).to.deep.equal({ status: "ready", data: 42 });
        expect(resolver.resolve).to.have.been.calledOnceWithExactly("profile-1");
        const [reader, capabilities] = operation.firstCall.args;
        expect(reader).to.equal(sessions.get("Sales:read"));
        expect(capabilities.supported).to.be.true;
        expect(capabilities.platform.majorVersion).to.equal(16);
    });

    test("reads the capabilities of a database once", async () => {
        const operation = sandbox.stub().resolves({ status: "ready" });

        await service.run("profile-1", undefined, operation);
        await service.run("profile-1", undefined, operation);

        expect(sessions.get("Sales:read")!.read).to.have.been.calledTwice;
        expect(operation).to.have.been.calledTwice;
    });

    test("reads the capabilities again on a new session, such as after a failover", async () => {
        const operation = sandbox.stub().resolves({ status: "ready" });

        await service.run("profile-1", undefined, operation);
        const session = sessions.get("Sales:read")!;
        (session as { generation: number }).generation = 2;
        await service.run("profile-1", undefined, operation);

        expect(session.read).to.have.callCount(4);
    });

    test("runs a change on a session for changes", async () => {
        const operation = sandbox.stub().resolves({ status: "ready" });

        await service.run("profile-1", "Orders", operation, "change");

        expect(operation.firstCall.args[0]).to.equal(sessions.get("Orders:change"));
        expect(sessions.get("Orders:read")!.read).to.have.been.calledTwice;
    });

    test("returns why the database cannot be read, without running the operation", async () => {
        const operation = sandbox.stub().resolves({ status: "ready" });

        pool.availability.returns(unavailable("dataPlaneDisabled"));
        expect(await service.run("profile-1", undefined, operation)).to.include({
            status: "unavailable",
            reason: "dataPlaneDisabled",
        });

        pool.availability.returns(undefined);
        resolver.resolve.resolves(unavailable("connectionNotFound"));
        expect(await service.run("profile-1", undefined, operation)).to.include({
            reason: "connectionNotFound",
        });

        resolver.resolve.resolves({ connection, database: "Sales" });
        pool.session.callsFake(() => ({
            ...fakeSession(),
            ensureOpen: sandbox.stub().resolves(unavailable("connectionFailed")),
        }));
        expect(await service.run("profile-1", undefined, operation)).to.include({
            reason: "connectionFailed",
        });
        expect(operation).to.not.have.been.called;
    });

    test("maps a failed capabilities read or a rejected request to a result", async () => {
        pool.session.callsFake(() => ({
            ...fakeSession(),
            read: sandbox.stub().rejects(new SqlReadError("Login failed.", "server", 18456)),
        }));
        const failed = await service.run("profile-1", undefined, sandbox.stub());
        expect(failed).to.deep.include({
            status: "failed",
            error: { message: "Login failed.", errorNumber: 18456 },
        });

        pool.session.callsFake(() => fakeSession());
        const rejected = await service.run(
            "profile-1",
            undefined,
            sandbox.stub().rejects(new RangeError('Value "x" is not a bigint.')),
        );
        expect(rejected).to.deep.include({ status: "failed" });
    });
});
