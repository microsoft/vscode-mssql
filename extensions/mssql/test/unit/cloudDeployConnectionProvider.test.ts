/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for the Cloud Deploy `ConnectionProvider` surface:
 *   * `FakeConnectionProvider` records invocations + honors per-env behavior.
 *   * `FakeConnectionHandle` records executions, returns canned rows, and
 *     remembers disposal.
 *   * `LiveConnectionProvider` delegates Container-source-of-truth envs to
 *     its strategy and rejects non-container envs with a deterministic
 *     `ConnectionError`.
 */

import { expect } from "chai";

import { SourceOfTruthKind } from "../../src/cloudDeploy/environments/types";
import {
    ConnectionError,
    ConnectionHandle,
    FakeConnectionHandle,
    FakeConnectionProvider,
    LiveConnectionProvider,
} from "../../src/cloudDeploy/validation/providers/connectionProvider";

import { makeEnvironmentWithValidations } from "./cloudDeployValidationTestHelpers";

suite("CloudDeploy ConnectionProvider", () => {
    // -------------------------------------------------------------------------
    // FakeConnectionProvider
    // -------------------------------------------------------------------------
    suite("FakeConnectionProvider", () => {
        test("connect() defaults to success and returns a FakeConnectionHandle", async () => {
            const provider = new FakeConnectionProvider();
            const env = makeEnvironmentWithValidations([]);
            const ctrl = new AbortController();

            const handle = await provider.connect(env, ctrl.signal);

            expect(handle).to.be.instanceOf(FakeConnectionHandle);
            expect(provider.invocations).to.deep.equal([{ envId: env.id, signalAborted: false }]);
            expect(provider.handles).to.have.length(1);
            expect(provider.handles[0]).to.equal(handle);
        });

        test("connect() throws ConnectionError when configured for failure", async () => {
            const provider = new FakeConnectionProvider();
            const env = makeEnvironmentWithValidations([]);
            provider.configure(env.id, {
                mode: "failure",
                kind: "auth-failed",
                message: "wrong password",
            });

            try {
                await provider.connect(env, new AbortController().signal);
                expect.fail("expected ConnectionError");
            } catch (err) {
                expect(err).to.be.instanceOf(ConnectionError);
                expect((err as ConnectionError).kind).to.equal("auth-failed");
                expect((err as ConnectionError).message).to.equal("wrong password");
            }
        });

        test("connect() in timeout mode waits for signal abort then throws timeout", async () => {
            const provider = new FakeConnectionProvider();
            const env = makeEnvironmentWithValidations([]);
            provider.configure(env.id, { mode: "timeout" });

            const ctrl = new AbortController();
            const promise = provider.connect(env, ctrl.signal);
            // Abort after a tick so the await has time to register.
            setTimeout(() => ctrl.abort(), 5);

            try {
                await promise;
                expect.fail("expected ConnectionError");
            } catch (err) {
                expect(err).to.be.instanceOf(ConnectionError);
                expect((err as ConnectionError).kind).to.equal("timeout");
            }
        });

        test("FakeConnectionHandle.execute records calls and returns canned rows", async () => {
            const provider = new FakeConnectionProvider();
            const env = makeEnvironmentWithValidations([]);
            provider.configure(env.id, {
                mode: "success",
                handle: {
                    executeResponses: { "SELECT @@VERSION": [["SQL Server 2022"]] },
                },
            });

            const handle = (await provider.connect(
                env,
                new AbortController().signal,
            )) as FakeConnectionHandle;
            const rows = await handle.execute("SELECT @@VERSION", new AbortController().signal);
            const fallbackRows = await handle.execute("SELECT 1", new AbortController().signal);

            expect(rows).to.deep.equal([["SQL Server 2022"]]);
            expect(fallbackRows).to.deep.equal([[]]);
            expect(handle.executions.map((e) => e.sql)).to.deep.equal([
                "SELECT @@VERSION",
                "SELECT 1",
            ]);
        });

        test("FakeConnectionHandle.dispose() is idempotent and sets the disposed flag", async () => {
            const provider = new FakeConnectionProvider();
            const env = makeEnvironmentWithValidations([]);
            const handle = (await provider.connect(
                env,
                new AbortController().signal,
            )) as FakeConnectionHandle;

            expect(handle.disposed).to.equal(false);
            await handle.dispose();
            expect(handle.disposed).to.equal(true);
            await handle.dispose();
            expect(handle.disposed).to.equal(true);
        });

        test("FakeConnectionHandle.execute throws when configured with executeError", async () => {
            const provider = new FakeConnectionProvider();
            const env = makeEnvironmentWithValidations([]);
            provider.configure(env.id, {
                mode: "success",
                handle: { executeError: new ConnectionError("connection-refused", "rst") },
            });

            const handle = await provider.connect(env, new AbortController().signal);
            try {
                await handle.execute("SELECT 1", new AbortController().signal);
                expect.fail("expected ConnectionError");
            } catch (err) {
                expect(err).to.be.instanceOf(ConnectionError);
                expect((err as ConnectionError).kind).to.equal("connection-refused");
            }
        });
    });

    // -------------------------------------------------------------------------
    // LiveConnectionProvider
    // -------------------------------------------------------------------------
    suite("LiveConnectionProvider", () => {
        test("delegates Container envs to the strategy with the right profile id", async () => {
            const stubHandle: ConnectionHandle = {
                execute: async () => [[]],
                dispose: async () => {},
            };
            const calls: Array<{ profileId: string; signalAborted: boolean }> = [];
            const provider = new LiveConnectionProvider({
                connectByProfileId: async (profileId, signal) => {
                    calls.push({ profileId, signalAborted: signal.aborted });
                    return stubHandle;
                },
            });
            const env = makeEnvironmentWithValidations([], {
                sourceOfTruth: {
                    kind: SourceOfTruthKind.Container,
                    connectionProfileId: "prof-42",
                },
            });

            const handle = await provider.connect(env, new AbortController().signal);

            expect(handle).to.equal(stubHandle);
            expect(calls).to.deep.equal([{ profileId: "prof-42", signalAborted: false }]);
        });

        test("throws ConnectionError(unknown) for non-Container source-of-truth envs", async () => {
            const provider = new LiveConnectionProvider({
                connectByProfileId: async () => {
                    throw new Error("strategy should not be called");
                },
            });
            const env = makeEnvironmentWithValidations([], {
                sourceOfTruth: { kind: SourceOfTruthKind.SqlProj, path: "/tmp/x.sqlproj" },
            });

            try {
                await provider.connect(env, new AbortController().signal);
                expect.fail("expected ConnectionError");
            } catch (err) {
                expect(err).to.be.instanceOf(ConnectionError);
                expect((err as ConnectionError).kind).to.equal("unknown");
                expect((err as ConnectionError).message).to.match(/no connection profile/);
            }
        });
    });
});
