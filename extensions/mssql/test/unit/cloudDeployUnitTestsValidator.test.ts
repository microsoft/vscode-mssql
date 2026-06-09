/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `UnitTestsValidator`:
 *   * Skipped for non-Container source-of-truth (SqlProj / Dacpac) without
 *     opening a connection.
 *   * Skipped when the tSQLt schema probe returns zero rows.
 *   * Skipped when the connection provider throws `ConnectionError`.
 *   * Passed when every tSQLt result row reports `"Success"`.
 *   * Failed with mixed Success / Failure / Error rows; summary counts
 *     line up.
 *   * Issues the expected SQL sequence: probe → RunAll → results.
 *   * Cancellation pre-connect (`signal.aborted` at entry) → throws.
 *   * Cancellation mid-flight (`mode: "timeout"` on the connection
 *     provider) → throws CancellationError.
 *   * Validator-itself crash (non-ConnectionError thrown from execute) is
 *     re-thrown so the runner classifies as Errored.
 *   * The connection handle is disposed on both success and failure paths.
 */

import { expect } from "chai";

import { SourceOfTruthKind, ValidationType } from "../../src/cloudDeploy/environments/types";
import { ValidationStatus, type UnitTestsPayload } from "../../src/cloudDeploy/runs/types";
import {
    CancellationError,
    ConnectionError,
    FakeConnectionProvider,
    UnitTestsValidator,
} from "../../src/cloudDeploy/validation";

import { makeEnvironmentWithValidations } from "./cloudDeployValidationTestHelpers";

const RUN_OPTS_BASE = { runId: "run-test" } as const;
const PROBE_SQL = "SELECT 1 FROM sys.schemas WHERE name = 'tSQLt'";
const RUN_ALL_SQL = "EXEC tSQLt.RunAll";
const RESULTS_SQL = "SELECT Class, TestCase, Result, Msg FROM tSQLt.TestResult ORDER BY Id";

function makeSqlProjEnv() {
    return makeEnvironmentWithValidations([], {
        sourceOfTruth: { kind: SourceOfTruthKind.SqlProj, path: "/work/proj.sqlproj" },
    });
}

function configureSuccessfulRun(
    provider: FakeConnectionProvider,
    envId: string,
    resultRows: unknown[][],
): void {
    provider.configure(envId, {
        mode: "success",
        handle: {
            executeResponses: {
                [PROBE_SQL]: [[1]],
                [RUN_ALL_SQL]: [],
                [RESULTS_SQL]: resultRows,
            },
        },
    });
}

suite("CloudDeploy UnitTestsValidator", () => {
    let provider: FakeConnectionProvider;
    let validator: UnitTestsValidator;

    setup(() => {
        provider = new FakeConnectionProvider();
        validator = new UnitTestsValidator(provider);
    });

    test("returns Skipped for SqlProj source-of-truth without opening a connection", async () => {
        const env = makeSqlProjEnv();

        const result = await validator.run(
            env,
            {},
            { ...RUN_OPTS_BASE, signal: new AbortController().signal },
        );

        expect(result.status).to.equal(ValidationStatus.Skipped);
        expect(result.validationId).to.equal(ValidationType.UnitTests);
        expect(result.displayName).to.equal("Unit Tests");
        const payload = result.payload as UnitTestsPayload;
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0].outcome).to.equal("skipped");
        expect(payload.summary).to.deep.equal({
            total: 0,
            passed: 0,
            failed: 0,
            skipped: 1,
            errored: 0,
        });
        expect(provider.invocations).to.have.length(0);
    });

    test("returns Skipped when tSQLt is not installed (probe yields zero rows)", async () => {
        const env = makeEnvironmentWithValidations([]);
        provider.configure(env.id, {
            mode: "success",
            handle: { executeResponses: { [PROBE_SQL]: [] } },
        });

        const result = await validator.run(
            env,
            {},
            { ...RUN_OPTS_BASE, signal: new AbortController().signal },
        );

        expect(result.status).to.equal(ValidationStatus.Skipped);
        const payload = result.payload as UnitTestsPayload;
        expect(payload.findings[0].outcome).to.equal("skipped");
        expect(payload.findings[0].message).to.match(/tSQLt is not installed/i);
        // Probe ran, but RunAll / results queries did not.
        const handle = provider.handles[0];
        expect(handle.executions.map((e) => e.sql)).to.deep.equal([PROBE_SQL]);
        expect(handle.disposed).to.equal(true);
    });

    test("returns Skipped when the connection provider throws ConnectionError", async () => {
        const env = makeEnvironmentWithValidations([]);
        provider.configure(env.id, {
            mode: "failure",
            kind: "auth-failed",
            message: "login failed for user 'sa'",
        });

        const result = await validator.run(
            env,
            {},
            { ...RUN_OPTS_BASE, signal: new AbortController().signal },
        );

        expect(result.status).to.equal(ValidationStatus.Skipped);
        const payload = result.payload as UnitTestsPayload;
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0].outcome).to.equal("skipped");
        expect(payload.findings[0].message).to.match(/auth-failed/);
        expect(payload.findings[0].message).to.match(/login failed for user 'sa'/);
    });

    test("returns Passed when every tSQLt row reports Success", async () => {
        const env = makeEnvironmentWithValidations([]);
        configureSuccessfulRun(provider, env.id, [
            ["MySchema", "testFoo", "Success", ""],
            ["MySchema", "testBar", "Success", null],
        ]);

        const result = await validator.run(
            env,
            {},
            { ...RUN_OPTS_BASE, signal: new AbortController().signal },
        );

        expect(result.status).to.equal(ValidationStatus.Passed);
        const payload = result.payload as UnitTestsPayload;
        expect(payload.summary).to.deep.equal({
            total: 2,
            passed: 2,
            failed: 0,
            skipped: 0,
            errored: 0,
        });
        expect(payload.findings.map((f) => f.testName)).to.deep.equal([
            "MySchema.testFoo",
            "MySchema.testBar",
        ]);
        expect(payload.findings.every((f) => f.outcome === "passed")).to.equal(true);
        // Passed findings do not carry a message.
        expect(payload.findings[0].message).to.equal(undefined);
    });

    test("returns Failed with mixed Success / Failure / Error rows and matching summary counts", async () => {
        const env = makeEnvironmentWithValidations([]);
        configureSuccessfulRun(provider, env.id, [
            ["S", "passing", "Success", ""],
            ["S", "broken", "Failure", "expected 1 got 2"],
            ["S", "blewUp", "Error", "Msg 50000, divide by zero"],
            ["S", "weird", "Whatever", "unknown status from a future tSQLt"],
        ]);

        const result = await validator.run(
            env,
            {},
            { ...RUN_OPTS_BASE, signal: new AbortController().signal },
        );

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as UnitTestsPayload;
        expect(payload.summary).to.deep.equal({
            total: 4,
            passed: 1,
            failed: 1,
            skipped: 0,
            // Unknown tSQLt result status maps to "errored" so it surfaces visibly.
            errored: 2,
        });
        expect(payload.findings[1]).to.include({
            outcome: "failed",
            message: "expected 1 got 2",
        });
        expect(payload.findings[2]).to.include({
            outcome: "errored",
            message: "Msg 50000, divide by zero",
        });
    });

    test("issues the expected SQL sequence (probe -> RunAll -> results)", async () => {
        const env = makeEnvironmentWithValidations([]);
        configureSuccessfulRun(provider, env.id, [["S", "t", "Success", ""]]);

        await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: new AbortController().signal });

        const handle = provider.handles[0];
        expect(handle.executions.map((e) => e.sql)).to.deep.equal([
            PROBE_SQL,
            RUN_ALL_SQL,
            RESULTS_SQL,
        ]);
        expect(handle.disposed).to.equal(true);
    });

    test("disposes the connection handle on the success path", async () => {
        const env = makeEnvironmentWithValidations([]);
        configureSuccessfulRun(provider, env.id, []);

        await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: new AbortController().signal });

        expect(provider.handles[0].disposed).to.equal(true);
    });

    test("disposes the connection handle when tSQLt is missing", async () => {
        const env = makeEnvironmentWithValidations([]);
        provider.configure(env.id, {
            mode: "success",
            handle: { executeResponses: { [PROBE_SQL]: [] } },
        });

        await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: new AbortController().signal });

        expect(provider.handles[0].disposed).to.equal(true);
    });

    test("throws CancellationError when the signal is already aborted at entry", async () => {
        const env = makeEnvironmentWithValidations([]);
        const controller = new AbortController();
        controller.abort();

        try {
            await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: controller.signal });
            expect.fail("expected CancellationError");
        } catch (err) {
            expect(err).to.be.instanceOf(CancellationError);
        }
        expect(provider.invocations).to.have.length(0);
    });

    test("throws CancellationError when the signal aborts during connect (mode: timeout)", async () => {
        const env = makeEnvironmentWithValidations([]);
        provider.configure(env.id, { mode: "timeout" });
        const controller = new AbortController();

        const pending = validator.run(env, {}, { ...RUN_OPTS_BASE, signal: controller.signal });
        controller.abort();

        try {
            await pending;
            expect.fail("expected CancellationError");
        } catch (err) {
            expect(err).to.be.instanceOf(CancellationError);
        }
    });

    test("re-throws non-ConnectionError thrown from execute (runner classifies as Errored)", async () => {
        const env = makeEnvironmentWithValidations([]);
        // success-mode connect, but execute throws a generic Error (simulates a
        // validator-internal crash rather than a transport failure).
        provider.configure(env.id, {
            mode: "success",
            handle: {
                executeError: new ConnectionError("unknown"), // overridden below
                executeResponses: {},
            },
        });
        // Replace the canned ConnectionError with a plain Error to exercise
        // the "non-ConnectionError → re-throw" path.
        // (FakeConnectionHandle's executeError is typed as ConnectionError,
        // so we mutate the handle list after the first connect.)
        const originalConnect = provider.connect.bind(provider);
        provider.connect = async (e, signal) => {
            const handle = await originalConnect(e, signal);
            (handle as unknown as { execute: () => Promise<never> }).execute = async () => {
                throw new Error("boom from inside the validator");
            };
            return handle;
        };

        try {
            await validator.run(
                env,
                {},
                { ...RUN_OPTS_BASE, signal: new AbortController().signal },
            );
            expect.fail("expected the plain Error to propagate");
        } catch (err) {
            expect(err).to.be.instanceOf(Error);
            expect((err as Error).message).to.match(/boom from inside the validator/);
        }
    });
});
