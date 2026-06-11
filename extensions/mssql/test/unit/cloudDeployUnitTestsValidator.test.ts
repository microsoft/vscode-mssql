/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `UnitTestsValidator` (Scope 2, decision D-C — runs against the
 * per-run ephemeral database the runner provisions, via `opts.ephemeralConnection`):
 *   * Skipped when no ephemeral connection was provisioned.
 *   * Skipped when the tSQLt schema probe returns zero rows.
 *   * Passed when every tSQLt result row reports `"Success"`.
 *   * Failed with mixed Success / Failure / Error rows; summary counts line up.
 *   * Issues the expected SQL sequence: probe → RunAll → results.
 *   * Cancellation pre-run (`signal.aborted` at entry) → throws.
 *   * A `ConnectionError` from execute → Skipped (transient, runner already gated).
 *   * A non-`ConnectionError` thrown from execute is re-thrown so the runner
 *     classifies as Errored.
 *   * The validator does NOT dispose the connection (the runner owns it).
 */

import { expect } from "chai";

import { ValidationType } from "../../src/cloudDeploy/environments/types";
import { ValidationStatus, type UnitTestsPayload } from "../../src/cloudDeploy/runs/types";
import {
    CancellationError,
    ConnectionError,
    FakeConnectionHandle,
    UnitTestsValidator,
} from "../../src/cloudDeploy/validation";

import { makeEnvironmentWithValidations } from "./cloudDeployValidationTestHelpers";

const RUN_OPTS_BASE = { runId: "run-test" } as const;
const PROBE_SQL = "SELECT 1 FROM sys.schemas WHERE name = 'tSQLt'";
const RUN_ALL_SQL = "EXEC tSQLt.RunAll";
const RESULTS_SQL = "SELECT Class, TestCase, Result, Msg FROM tSQLt.TestResult ORDER BY Id";
const ENV = makeEnvironmentWithValidations([]);

/** Builds a `FakeConnectionHandle` whose canned responses model a tSQLt run. */
function tsqltHandle(resultRows: unknown[][]): FakeConnectionHandle {
    return new FakeConnectionHandle({
        executeResponses: {
            [PROBE_SQL]: [[1]],
            [RUN_ALL_SQL]: [],
            [RESULTS_SQL]: resultRows,
        },
    });
}

function run(
    validator: UnitTestsValidator,
    ephemeralConnection: FakeConnectionHandle | undefined,
    signal: AbortSignal = new AbortController().signal,
) {
    return validator.run(ENV, {}, { ...RUN_OPTS_BASE, signal, ephemeralConnection });
}

suite("CloudDeploy UnitTestsValidator", () => {
    let validator: UnitTestsValidator;

    setup(() => {
        validator = new UnitTestsValidator();
    });

    test("returns Skipped when no ephemeral connection was provisioned", async () => {
        const result = await run(validator, undefined);

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
    });

    test("returns Skipped when tSQLt is not installed (probe yields zero rows)", async () => {
        const handle = new FakeConnectionHandle({ executeResponses: { [PROBE_SQL]: [] } });

        const result = await run(validator, handle);

        expect(result.status).to.equal(ValidationStatus.Skipped);
        const payload = result.payload as UnitTestsPayload;
        expect(payload.findings[0].outcome).to.equal("skipped");
        expect(payload.findings[0].message).to.match(/tSQLt is not installed/i);
        // Probe ran, but RunAll / results queries did not.
        expect(handle.executions.map((e) => e.sql)).to.deep.equal([PROBE_SQL]);
    });

    test("returns Skipped when execute throws a ConnectionError", async () => {
        const handle = new FakeConnectionHandle({
            executeError: new ConnectionError("auth-failed", "login failed for user 'sa'"),
        });

        const result = await run(validator, handle);

        expect(result.status).to.equal(ValidationStatus.Skipped);
        const payload = result.payload as UnitTestsPayload;
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0].outcome).to.equal("skipped");
        expect(payload.findings[0].message).to.match(/auth-failed/);
        expect(payload.findings[0].message).to.match(/login failed for user 'sa'/);
    });

    test("returns Passed when every tSQLt row reports Success", async () => {
        const handle = tsqltHandle([
            ["MySchema", "testFoo", "Success", ""],
            ["MySchema", "testBar", "Success", null],
        ]);

        const result = await run(validator, handle);

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
        expect(payload.findings[0].message).to.equal(undefined);
    });

    test("returns Failed with mixed Success / Failure / Error rows and matching summary counts", async () => {
        const handle = tsqltHandle([
            ["S", "passing", "Success", ""],
            ["S", "broken", "Failure", "expected 1 got 2"],
            ["S", "blewUp", "Error", "Msg 50000, divide by zero"],
            ["S", "weird", "Whatever", "unknown status from a future tSQLt"],
        ]);

        const result = await run(validator, handle);

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
        const handle = tsqltHandle([["S", "t", "Success", ""]]);

        await run(validator, handle);

        expect(handle.executions.map((e) => e.sql)).to.deep.equal([
            PROBE_SQL,
            RUN_ALL_SQL,
            RESULTS_SQL,
        ]);
    });

    test("does NOT dispose the connection (the runner owns it)", async () => {
        const handle = tsqltHandle([]);

        await run(validator, handle);

        expect(handle.disposed).to.equal(false);
    });

    test("throws CancellationError when the signal is already aborted at entry", async () => {
        const handle = tsqltHandle([]);
        const controller = new AbortController();
        controller.abort();

        try {
            await run(validator, handle, controller.signal);
            expect.fail("expected CancellationError");
        } catch (err) {
            expect(err).to.be.instanceOf(CancellationError);
        }
        // No query was issued.
        expect(handle.executions).to.have.length(0);
    });

    test("re-throws a non-ConnectionError thrown from execute (runner classifies as Errored)", async () => {
        const handle = new FakeConnectionHandle();
        handle.execute = async () => {
            throw new Error("boom from inside the validator");
        };

        try {
            await run(validator, handle);
            expect.fail("expected the plain Error to propagate");
        } catch (err) {
            expect(err).to.be.instanceOf(Error);
            expect((err as Error).message).to.match(/boom from inside the validator/);
            expect(err).to.not.be.instanceOf(ConnectionError);
        }
    });
});
