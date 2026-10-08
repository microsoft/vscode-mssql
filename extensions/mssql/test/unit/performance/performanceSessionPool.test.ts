/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { SqlReadError } from "sql-core";
import { DataPlaneErrorCodes, SqlDataPlaneError } from "../../../src/services/sqlDataPlane/api";
import { prepareConnection } from "../../../src/services/metadata/profileAuthAdapter";
import {
    PerformanceSessionPool,
    dataPlaneSettings,
    performanceApplicationName,
} from "../../../src/performance/performanceSessionPool";
import { FakeConnectionService, fakeHost, testConnection } from "./dataPlaneFakes";

suite("Performance session pool", () => {
    let sandbox: sinon.SinonSandbox;
    let service: FakeConnectionService;
    let pool: PerformanceSessionPool;

    setup(() => {
        sandbox = sinon.createSandbox();
        service = new FakeConnectionService();
        pool = new PerformanceSessionPool(fakeHost(service), { idleTimeoutMs: 1_000 });
    });

    teardown(() => {
        pool.dispose();
        sandbox.restore();
    });

    suite("keys", () => {
        test("keys sessions by connection identity, database, and purpose", () => {
            const connection = testConnection();
            const session = pool.session(connection, "Db1", "read");

            expect(pool.session(testConnection(), "Db1", "read")).to.equal(session);
            expect(pool.session(connection, "Db1", "change")).to.not.equal(session);
            expect(pool.session(connection, "Db2", "read")).to.not.equal(session);
            expect(pool.session(testConnection("other-server"), "Db1", "read")).to.not.equal(
                session,
            );
        });

        test("ignores display properties of the profile", () => {
            const renamed = prepareConnection(
                {
                    server: "perf-server",
                    user: "perf-user",
                    authenticationType: "SqlLogin",
                    profileName: "Renamed profile",
                },
                { lookupPassword: async () => "secret" },
            );

            expect(pool.session(renamed, "Db1", "read")).to.equal(
                pool.session(testConnection(), "Db1", "read"),
            );
        });
    });

    suite("sessions", () => {
        test("opens one dedicated session and reuses it", async () => {
            const connection = testConnection();
            const session = pool.session(connection, "Db1", "read");

            await session.read("SELECT 1");
            await session.read("SELECT 2");

            expect(service.openParams).to.have.length(1);
            expect(service.openParams[0]).to.deep.include({
                profile: connection.profileRef,
                database: "Db1",
                applicationName: performanceApplicationName,
            });
            expect(service.openParams[0].auth).to.equal(connection.auth);
            expect(service.lastSession.queries).to.have.length(2);
        });

        test("opens a separate session for changes", async () => {
            await pool.session(testConnection(), "Db1", "read").read("SELECT 1");
            await pool
                .session(testConnection(), "Db1", "change")
                .read("EXEC sp_query_store_force_plan 1, 1");

            expect(service.sessions).to.have.length(2);
            expect(service.sessions[1].queries[0].text).to.contain("force_plan");
        });

        test("reopens a session that was lost or closed", async () => {
            const session = pool.session(testConnection(), "Db1", "read");
            await session.read("SELECT 1");

            service.lastSession.setState("lost");
            await session.read("SELECT 2");
            service.lastSession.setState("closed");
            await session.read("SELECT 3");

            expect(service.sessions).to.have.length(3);
            expect(service.sessions.map((fake) => fake.queries.length)).to.deep.equal([1, 1, 1]);
        });

        test("changes the generation when the session is dropped or reopened", async () => {
            const session = pool.session(testConnection(), "Db1", "read");
            await session.read("SELECT 1");
            const opened = session.generation;
            await session.read("SELECT 2");
            expect(session.generation).to.equal(opened);

            service.lastSession.setState("lost");
            const dropped = session.generation;
            expect(dropped).to.not.equal(opened);

            await session.read("SELECT 3");
            expect(session.generation).to.not.equal(dropped);
        });

        test("dispose closes every session and refuses new ones", async () => {
            await pool.session(testConnection(), "Db1", "read").read("SELECT 1");
            await pool.session(testConnection(), "Db2", "read").read("SELECT 1");

            pool.dispose();

            expect(service.sessions.map((fake) => fake.disposeCount)).to.deep.equal([1, 1]);
            expect(() => pool.session(testConnection(), "Db1", "read")).to.throw();
        });
    });

    suite("idle sessions", () => {
        let clock: sinon.SinonFakeTimers;

        setup(() => {
            clock = sandbox.useFakeTimers({ shouldClearNativeTimers: true });
        });

        test("closes a session after the idle timeout and reopens it on next use", async () => {
            const session = pool.session(testConnection(), "Db1", "read");
            await session.read("SELECT 1");

            await clock.tickAsync(999);
            expect(service.lastSession.disposeCount).to.equal(0);
            await clock.tickAsync(1);
            expect(service.lastSession.disposeCount).to.equal(1);

            await session.read("SELECT 2");
            expect(service.sessions).to.have.length(2);
        });

        test("activity postpones the idle close", async () => {
            const session = pool.session(testConnection(), "Db1", "read");
            await session.read("SELECT 1");

            await clock.tickAsync(800);
            await session.read("SELECT 2");
            await clock.tickAsync(800);

            expect(service.lastSession.disposeCount).to.equal(0);
            expect(service.sessions).to.have.length(1);
        });

        test("closes a session that was opened but never read", async () => {
            expect(await pool.session(testConnection(), "Db1", "read").ensureOpen()).to.equal(
                undefined,
            );

            await clock.tickAsync(1_000);

            expect(service.lastSession.disposeCount).to.equal(1);
        });
    });

    suite("availability", () => {
        test("reports the SQL data plane preview when it is off", () => {
            const disabled = new PerformanceSessionPool(
                fakeHost(service, { isEnabled: () => false }),
            );

            const result = disabled.availability();

            expect(result).to.deep.equal({
                status: "unavailable",
                reason: "dataPlaneDisabled",
                requiredSettings: [...dataPlaneSettings],
            });
            expect(JSON.parse(JSON.stringify(result))).to.deep.equal(result);
        });

        test("reports a needed reload when the preview was turned on after activation", () => {
            const notLoaded = new PerformanceSessionPool(
                fakeHost(service, { wasEnabledAtActivation: () => false }),
            );

            expect(notLoaded.availability()?.reason).to.equal("reloadRequired");
            expect(pool.availability()).to.equal(undefined);
        });

        test("maps open failures to reasons", async () => {
            const stopped = new PerformanceSessionPool(
                fakeHost(service, {
                    serviceForProfile: () => Promise.reject(new Error("backend did not start")),
                }),
            );
            expect(
                await stopped.session(testConnection(), "Db1", "read").ensureOpen(),
            ).to.deep.equal({
                status: "unavailable",
                reason: "dataPlaneUnavailable",
                detail: "backend did not start",
            });

            service.openError = new SqlDataPlaneError(
                DataPlaneErrorCodes.unavailable,
                "SQL Tools Service v2 is unavailable.",
            );
            expect(
                (await pool.session(testConnection(), "Db1", "read").ensureOpen())?.reason,
            ).to.equal("connectionFailed");

            service.availability = {
                state: "unavailable",
                backend: "fake",
                reason: "x",
                retryable: true,
            };
            expect(
                (await pool.session(testConnection(), "Db2", "read").ensureOpen())?.reason,
            ).to.equal("dataPlaneUnavailable");

            service.openError = new SqlDataPlaneError(
                DataPlaneErrorCodes.capabilityUnsupported,
                "integrated authentication is not supported",
            );
            expect(
                (await pool.session(testConnection(), "Db3", "read").ensureOpen())?.reason,
            ).to.equal("authenticationUnsupported");
        });

        test("fails reads with a connection error when the session does not open", async () => {
            service.openError = new Error("Login failed.");

            let failure: unknown;
            try {
                await pool.session(testConnection(), "Db1", "read").read("SELECT 1");
            } catch (error) {
                failure = error;
            }

            expect(failure).to.be.instanceOf(SqlReadError);
            expect((failure as SqlReadError).kind).to.equal("connection");
        });
    });
});
