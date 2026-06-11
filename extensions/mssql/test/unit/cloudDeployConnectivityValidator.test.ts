/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `ConnectivityValidator` (Scope 2, decision M7 — repurposed to the
 * per-run ephemeral-database health check):
 *   * Pass case — `SELECT @@VERSION` on the injected ephemeral connection
 *     returns a row → status `Passed`, `outcome: "reachable"`, version set.
 *   * Pass case with no row → `Passed`, `summary.reachable: true`, no version.
 *   * Missing ephemeral connection (provisioning failed) → `Failed` with
 *     `summary.reachable: false` — this is the gate.
 *   * Probe query error → `Failed` with the matching `ConnectionError` outcome.
 *   * Cancellation — pre-aborted signal short-circuits before probing.
 *   * Errored path — a non-`ConnectionError` thrown from the connection is
 *     re-thrown so the runner classifies as `Errored`, not `Failed`.
 *   * The validator does NOT dispose the connection (the runner owns it).
 */

import { expect } from "chai";

import { ValidationType } from "../../src/cloudDeploy/environments/types";
import { ValidationStatus, type ConnectivityPayload } from "../../src/cloudDeploy/runs/types";
import {
    CancellationError,
    ConnectionError,
    ConnectivityValidator,
    FakeConnectionHandle,
} from "../../src/cloudDeploy/validation";

import { makeEnvironmentWithValidations } from "./cloudDeployValidationTestHelpers";

const RUN_OPTS_BASE = { runId: "run-test" } as const;
const ENV = makeEnvironmentWithValidations([]);

function run(
    validator: ConnectivityValidator,
    ephemeralConnection: FakeConnectionHandle | undefined,
    signal: AbortSignal = new AbortController().signal,
) {
    return validator.run(ENV, {}, { ...RUN_OPTS_BASE, signal, ephemeralConnection });
}

suite("CloudDeploy ConnectivityValidator", () => {
    let validator: ConnectivityValidator;

    setup(() => {
        validator = new ConnectivityValidator();
    });

    test("returns Passed with serverVersion when probe yields a row", async () => {
        const handle = new FakeConnectionHandle({
            executeResponses: { "SELECT @@VERSION": [["SQL Server 2022 16.0.x"]] },
        });

        const result = await run(validator, handle);

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
        // FakeConnectionHandle returns [[]] for unknown SQL → version undefined.
        const handle = new FakeConnectionHandle();

        const result = await run(validator, handle);

        expect(result.status).to.equal(ValidationStatus.Passed);
        const payload = result.payload as ConnectivityPayload;
        expect(payload.summary).to.deep.equal({ reachable: true });
        expect(payload.findings[0].message).to.equal("Connected.");
    });

    test("returns Failed when no ephemeral connection was provisioned (the gate)", async () => {
        const result = await run(validator, undefined);

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as ConnectivityPayload;
        expect(payload.summary).to.deep.equal({ reachable: false });
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0]).to.include({ kind: "connectivity", outcome: "unknown" });
    });

    test("returns Failed when the probe query itself errors", async () => {
        const handle = new FakeConnectionHandle({
            executeError: new ConnectionError("host-unreachable", "lost connection mid-query"),
        });

        const result = await run(validator, handle);

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as ConnectivityPayload;
        expect(payload.findings[0].outcome).to.equal("host-unreachable");
        expect(payload.findings[0].message).to.equal("lost connection mid-query");
    });

    test("does NOT dispose the connection (the runner owns it)", async () => {
        const handle = new FakeConnectionHandle();

        await run(validator, handle);

        expect(handle.disposed).to.equal(false);
    });

    test("propagates CancellationError when the signal is aborted before probing", async () => {
        const handle = new FakeConnectionHandle();
        const ctrl = new AbortController();
        ctrl.abort();

        try {
            await run(validator, handle, ctrl.signal);
            expect.fail("expected CancellationError");
        } catch (err) {
            expect(err).to.be.instanceOf(CancellationError);
        }
        expect(handle.executions).to.have.length(0);
    });

    test("re-throws a non-ConnectionError so the runner classifies as Errored", async () => {
        const handle = new FakeConnectionHandle();
        handle.execute = async () => {
            throw new Error("kaboom");
        };

        try {
            await run(validator, handle);
            expect.fail("expected the non-ConnectionError to bubble out");
        } catch (err) {
            expect(err).to.be.instanceOf(Error);
            expect((err as Error).message).to.equal("kaboom");
            expect(err).to.not.be.instanceOf(ConnectionError);
            expect(err).to.not.be.instanceOf(CancellationError);
        }
    });

    test("issues exactly one SELECT @@VERSION probe per run", async () => {
        const handle = new FakeConnectionHandle();

        await run(validator, handle);

        expect(handle.executions.map((e) => e.sql)).to.deep.equal(["SELECT @@VERSION"]);
    });

    test("stamps startedAtMs/endedAtMs in nondecreasing order", async () => {
        const handle = new FakeConnectionHandle();

        const result = await run(validator, handle);

        expect(result.endedAtMs).to.be.at.least(result.startedAtMs);
    });
});
