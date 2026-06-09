/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `ConnectivityValidator`:
 *   * Pass case — `SELECT @@VERSION` returns a row → status `Passed`,
 *     `outcome: "reachable"`, `summary.serverVersion` populated.
 *   * Pass case with no row → status `Passed`, `summary.reachable: true`,
 *     no `serverVersion`.
 *   * Failure modes — each `ConnectionFailureKind` flows through the
 *     ConnectionError → `Failed` result with matching `outcome`.
 *   * Cancellation — pre-aborted signal short-circuits before connecting;
 *     mid-execute abort surfaces as `CancellationError`.
 *   * Disposal — the handle's `dispose()` is called on both success and
 *     failure paths.
 *   * Errored path — non-`ConnectionError` thrown from the provider is
 *     re-thrown so the runner classifies as `Errored`, not `Failed`.
 */

import { expect } from "chai";

import { ValidationType } from "../../src/cloudDeploy/environments/types";
import { ValidationStatus, type ConnectivityPayload } from "../../src/cloudDeploy/runs/types";
import {
    CancellationError,
    ConnectionError,
    ConnectivityValidator,
    FakeConnectionHandle,
    FakeConnectionProvider,
} from "../../src/cloudDeploy/validation";

import { makeEnvironmentWithValidations } from "./cloudDeployValidationTestHelpers";

const RUN_OPTS_BASE = { runId: "run-test" } as const;

suite("CloudDeploy ConnectivityValidator", () => {
    let provider: FakeConnectionProvider;
    let validator: ConnectivityValidator;

    setup(() => {
        provider = new FakeConnectionProvider();
        validator = new ConnectivityValidator(provider);
    });

    test("returns Passed with serverVersion when probe yields a row", async () => {
        const env = makeEnvironmentWithValidations([]);
        provider.configure(env.id, {
            mode: "success",
            handle: { executeResponses: { "SELECT @@VERSION": [["SQL Server 2022 16.0.x"]] } },
        });

        const result = await validator.run(
            env,
            {},
            {
                ...RUN_OPTS_BASE,
                signal: new AbortController().signal,
            },
        );

        expect(result.status).to.equal(ValidationStatus.Passed);
        expect(result.validationId).to.equal(ValidationType.Connectivity);
        expect(result.displayName).to.equal("Connectivity");
        const payload = result.payload as ConnectivityPayload;
        expect(payload.validationType).to.equal(ValidationType.Connectivity);
        expect(payload.summary).to.deep.equal({
            reachable: true,
            serverVersion: "SQL Server 2022 16.0.x",
        });
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0]).to.include({
            kind: "connectivity",
            outcome: "reachable",
            severity: "info",
        });
        expect(payload.findings[0].message).to.match(/SQL Server 2022 16\.0\.x/);
    });

    test("returns Passed with no serverVersion when probe yields an empty row", async () => {
        const env = makeEnvironmentWithValidations([]);
        // Default success behavior with no canned response → handle returns [[]]
        // (one empty row) so extractServerVersion returns undefined.
        provider.configure(env.id, { mode: "success" });

        const result = await validator.run(
            env,
            {},
            {
                ...RUN_OPTS_BASE,
                signal: new AbortController().signal,
            },
        );

        expect(result.status).to.equal(ValidationStatus.Passed);
        const payload = result.payload as ConnectivityPayload;
        expect(payload.summary).to.deep.equal({ reachable: true });
        expect(payload.findings[0].message).to.equal("Connected.");
    });

    test("disposes the connection on the success path", async () => {
        const env = makeEnvironmentWithValidations([]);
        provider.configure(env.id, { mode: "success" });

        await validator.run(
            env,
            {},
            {
                ...RUN_OPTS_BASE,
                signal: new AbortController().signal,
            },
        );

        expect(provider.handles).to.have.length(1);
        expect(provider.handles[0].disposed).to.equal(true);
    });

    test("returns Failed with outcome 'connection-refused' on transport failure", async () => {
        const env = makeEnvironmentWithValidations([]);
        provider.configure(env.id, {
            mode: "failure",
            kind: "connection-refused",
            message: "ECONNREFUSED",
        });

        const result = await validator.run(
            env,
            {},
            {
                ...RUN_OPTS_BASE,
                signal: new AbortController().signal,
            },
        );

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as ConnectivityPayload;
        expect(payload.summary).to.deep.equal({ reachable: false });
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0]).to.include({
            kind: "connectivity",
            outcome: "connection-refused",
            severity: "error",
            message: "ECONNREFUSED",
        });
    });

    test("returns Failed with outcome 'auth-failed' for auth errors", async () => {
        const env = makeEnvironmentWithValidations([]);
        provider.configure(env.id, { mode: "failure", kind: "auth-failed" });

        const result = await validator.run(
            env,
            {},
            {
                ...RUN_OPTS_BASE,
                signal: new AbortController().signal,
            },
        );

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as ConnectivityPayload;
        expect(payload.findings[0].outcome).to.equal("auth-failed");
    });

    test("returns Failed when the probe query itself errors", async () => {
        const env = makeEnvironmentWithValidations([]);
        provider.configure(env.id, {
            mode: "success",
            handle: {
                executeError: new ConnectionError("host-unreachable", "lost connection mid-query"),
            },
        });

        const result = await validator.run(
            env,
            {},
            {
                ...RUN_OPTS_BASE,
                signal: new AbortController().signal,
            },
        );

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as ConnectivityPayload;
        expect(payload.findings[0].outcome).to.equal("host-unreachable");
        expect(payload.findings[0].message).to.equal("lost connection mid-query");
        // Handle disposal still happens on the failure path.
        expect(provider.handles[0].disposed).to.equal(true);
    });

    test("propagates CancellationError when signal is aborted before connect", async () => {
        const env = makeEnvironmentWithValidations([]);
        provider.configure(env.id, { mode: "success" });
        const ctrl = new AbortController();
        ctrl.abort();

        try {
            await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: ctrl.signal });
            expect.fail("expected CancellationError");
        } catch (err) {
            expect(err).to.be.instanceOf(CancellationError);
        }
        // Validator never opened a connection.
        expect(provider.invocations).to.have.length(0);
    });

    test("translates timeout-aborted connect into CancellationError", async () => {
        const env = makeEnvironmentWithValidations([]);
        provider.configure(env.id, { mode: "timeout" });
        const ctrl = new AbortController();
        const promise = validator.run(env, {}, { ...RUN_OPTS_BASE, signal: ctrl.signal });
        setTimeout(() => ctrl.abort(), 5);

        try {
            await promise;
            expect.fail("expected CancellationError");
        } catch (err) {
            expect(err).to.be.instanceOf(CancellationError);
            // Reason defaults to "user"; the runner reconciles it against the
            // signal sentinel and stamps "timeout" if applicable.
            expect((err as CancellationError).reason).to.equal("user");
        }
    });

    test("re-throws non-ConnectionError so the runner classifies as Errored", async () => {
        const env = makeEnvironmentWithValidations([]);
        // FakeConnectionHandle's executeError is required to be a ConnectionError;
        // simulate a programmer-error throw via a wrapped provider.
        const buggyProvider = new FakeConnectionProvider();
        const realConnect = buggyProvider.connect.bind(buggyProvider);
        buggyProvider.connect = async (e, s) => {
            await realConnect(e, s);
            throw new Error("kaboom");
        };
        const buggyValidator = new ConnectivityValidator(buggyProvider);

        try {
            await buggyValidator.run(
                env,
                {},
                {
                    ...RUN_OPTS_BASE,
                    signal: new AbortController().signal,
                },
            );
            expect.fail("expected non-ConnectionError to bubble out");
        } catch (err) {
            expect(err).to.be.instanceOf(Error);
            expect((err as Error).message).to.equal("kaboom");
            // Not a ConnectionError; classified as Errored by the runner.
            expect(err).to.not.be.instanceOf(ConnectionError);
            expect(err).to.not.be.instanceOf(CancellationError);
        }
    });

    test("stamps startedAtMs/endedAtMs in nondecreasing order", async () => {
        const env = makeEnvironmentWithValidations([]);
        provider.configure(env.id, { mode: "success" });

        const result = await validator.run(
            env,
            {},
            {
                ...RUN_OPTS_BASE,
                signal: new AbortController().signal,
            },
        );

        expect(result.endedAtMs).to.be.at.least(result.startedAtMs);
    });

    // Use FakeConnectionHandle's execution log to confirm the probe SQL.
    test("issues exactly one SELECT @@VERSION probe per run", async () => {
        const env = makeEnvironmentWithValidations([]);
        provider.configure(env.id, { mode: "success" });

        await validator.run(
            env,
            {},
            {
                ...RUN_OPTS_BASE,
                signal: new AbortController().signal,
            },
        );

        const handle = provider.handles[0];
        expect(handle).to.be.instanceOf(FakeConnectionHandle);
        expect(handle.executions.map((e) => e.sql)).to.deep.equal(["SELECT @@VERSION"]);
    });
});
