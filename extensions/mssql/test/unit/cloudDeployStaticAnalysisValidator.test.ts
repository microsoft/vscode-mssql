/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `StaticAnalysisValidator`:
 *   * Skipped when sourceOfTruth is `Container` (no project file to scan).
 *   * Passed when sqlpackage exits 0 with no diagnostics on either stream.
 *   * Passed with parsed warnings when sqlpackage exits 0 with stderr
 *     diagnostics (warnings don't fail by default; failOn promotion is
 *     deferred to TBD-7).
 *   * Failed with parsed errors when sqlpackage exits non-zero and emits
 *     `Error SQLnnnnn:` diagnostics.
 *   * Failed with synthesized finding when sqlpackage exits non-zero and
 *     emits no parseable diagnostics.
 *   * Cancellation pre-spawn (`signal.aborted` checked at entry) → throws.
 *   * Cancellation mid-spawn (subprocess aborted by FakeProcessProvider) →
 *     throws CancellationError.
 *   * Spawn failure (binary not found) → re-thrown so the runner classifies
 *     as Errored.
 *   * Sqlpackage command override is honored (lets the service layer pass
 *     an absolute path).
 *   * Both SqlProj and Dacpac source-of-truth flow through, with the path
 *     forwarded to sqlpackage via `/SourceFile:`.
 */

import { expect } from "chai";

import { SourceOfTruthKind, ValidationType } from "../../src/cloudDeploy/environments/types";
import { ValidationStatus, type StaticAnalysisPayload } from "../../src/cloudDeploy/runs/types";
import {
    CancellationError,
    FakeProcessProvider,
    StaticAnalysisValidator,
} from "../../src/cloudDeploy/validation";

import { makeEnvironmentWithValidations } from "./cloudDeployValidationTestHelpers";

const RUN_OPTS_BASE = { runId: "run-test" } as const;
const PROJECT_PATH = "/work/proj.sqlproj";

function makeSqlProjEnv() {
    return makeEnvironmentWithValidations([], {
        sourceOfTruth: { kind: SourceOfTruthKind.SqlProj, path: PROJECT_PATH },
    });
}

function makeDacpacEnv() {
    return makeEnvironmentWithValidations([], {
        sourceOfTruth: { kind: SourceOfTruthKind.Dacpac, path: "/work/proj.dacpac" },
    });
}

suite("CloudDeploy StaticAnalysisValidator", () => {
    let processes: FakeProcessProvider;
    let validator: StaticAnalysisValidator;

    setup(() => {
        processes = new FakeProcessProvider();
        validator = new StaticAnalysisValidator(processes);
    });

    test("returns Skipped for Container source-of-truth without spawning sqlpackage", async () => {
        const env = makeEnvironmentWithValidations([]); // default Container

        const result = await validator.run(
            env,
            {},
            { ...RUN_OPTS_BASE, signal: new AbortController().signal },
        );

        expect(result.status).to.equal(ValidationStatus.Skipped);
        expect(result.validationId).to.equal(ValidationType.StaticAnalysis);
        expect(result.displayName).to.equal("Static Analysis");
        const payload = result.payload as StaticAnalysisPayload;
        expect(payload.validationType).to.equal(ValidationType.StaticAnalysis);
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0]).to.include({
            kind: "static-analysis",
            severity: "info",
            ruleId: "SOURCE_OF_TRUTH_UNSUPPORTED",
        });
        expect(processes.invocations).to.have.length(0);
    });

    test("returns Passed with zero findings when sqlpackage exits 0 cleanly", async () => {
        const env = makeSqlProjEnv();
        processes.respond("sqlpackage", "/Action:DeployReport", {
            mode: "exit",
            exitCode: 0,
            stdout: "<DeployReport/>\n",
            stderr: "",
        });

        const result = await validator.run(
            env,
            {},
            { ...RUN_OPTS_BASE, signal: new AbortController().signal },
        );

        expect(result.status).to.equal(ValidationStatus.Passed);
        const payload = result.payload as StaticAnalysisPayload;
        expect(payload.findings).to.have.length(0);
        expect(payload.summary).to.deep.equal({ info: 0, warning: 0, error: 0 });
    });

    test("forwards /SourceFile to sqlpackage with the SqlProj path", async () => {
        const env = makeSqlProjEnv();
        processes.respond("sqlpackage", "/Action:DeployReport", {
            mode: "exit",
            exitCode: 0,
        });

        await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: new AbortController().signal });

        expect(processes.invocations).to.have.length(1);
        expect(processes.invocations[0].command).to.equal("sqlpackage");
        expect(processes.invocations[0].args).to.deep.equal([
            "/Action:DeployReport",
            `/SourceFile:${PROJECT_PATH}`,
        ]);
    });

    test("supports Dacpac source-of-truth (forwards the dacpac path)", async () => {
        const env = makeDacpacEnv();
        processes.respond("sqlpackage", "/Action:DeployReport", {
            mode: "exit",
            exitCode: 0,
        });

        await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: new AbortController().signal });

        expect(processes.invocations[0].args[1]).to.equal("/SourceFile:/work/proj.dacpac");
    });

    test("returns Passed with parsed warnings when sqlpackage exits 0 + Warning lines", async () => {
        const env = makeSqlProjEnv();
        processes.respond("sqlpackage", "/Action:DeployReport", {
            mode: "exit",
            exitCode: 0,
            stderr: [
                "Warning SQL71558: The object reference [dbo].[t] differs from the source.",
                "Warning SQL71562: Procedure [dbo].[p] contains an unresolved reference.",
                "noise that does not match",
            ].join("\n"),
        });

        const result = await validator.run(
            env,
            {},
            { ...RUN_OPTS_BASE, signal: new AbortController().signal },
        );

        expect(result.status).to.equal(ValidationStatus.Passed);
        const payload = result.payload as StaticAnalysisPayload;
        expect(payload.findings).to.have.length(2);
        expect(payload.findings[0]).to.include({
            kind: "static-analysis",
            severity: "warning",
            ruleId: "SQL71558",
        });
        expect(payload.findings[0].message).to.match(/object reference/);
        expect(payload.summary).to.deep.equal({ info: 0, warning: 2, error: 0 });
    });

    test("returns Failed with parsed error findings when sqlpackage exits non-zero", async () => {
        const env = makeSqlProjEnv();
        processes.respond("sqlpackage", "/Action:DeployReport", {
            mode: "exit",
            exitCode: 1,
            stderr: [
                "Error SQL70001: Unresolved reference to object [dbo].[Missing].",
                "Warning SQL71558: trailing warning",
            ].join("\n"),
        });

        const result = await validator.run(
            env,
            {},
            { ...RUN_OPTS_BASE, signal: new AbortController().signal },
        );

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as StaticAnalysisPayload;
        expect(payload.findings).to.have.length(2);
        expect(payload.findings[0]).to.include({
            severity: "error",
            ruleId: "SQL70001",
        });
        expect(payload.summary).to.deep.equal({ info: 0, warning: 1, error: 1 });
    });

    test("synthesizes a single error finding when failure has no parseable diagnostics", async () => {
        const env = makeSqlProjEnv();
        processes.respond("sqlpackage", "/Action:DeployReport", {
            mode: "exit",
            exitCode: 5,
            stderr: "*** Unhandled Exception in sqlpackage. Aborting.",
        });

        const result = await validator.run(
            env,
            {},
            { ...RUN_OPTS_BASE, signal: new AbortController().signal },
        );

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as StaticAnalysisPayload;
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0]).to.include({
            severity: "error",
            ruleId: "SQLPACKAGE_FAILED",
        });
        expect(payload.findings[0].message).to.match(/exited with code 5/);
        expect(payload.findings[0].message).to.match(/Unhandled Exception/);
    });

    test("throws CancellationError when signal is pre-aborted", async () => {
        const env = makeSqlProjEnv();
        const ctrl = new AbortController();
        ctrl.abort();

        try {
            await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: ctrl.signal });
            expect.fail("expected CancellationError");
        } catch (err) {
            expect(err).to.be.instanceOf(CancellationError);
            expect((err as CancellationError).reason).to.equal("user");
        }
        expect(processes.invocations).to.have.length(0);
    });

    test("throws CancellationError when subprocess is aborted mid-flight", async () => {
        const env = makeSqlProjEnv();
        processes.respond("sqlpackage", "/Action:DeployReport", { mode: "hang" });
        const ctrl = new AbortController();

        const promise = validator.run(env, {}, { ...RUN_OPTS_BASE, signal: ctrl.signal });
        setTimeout(() => ctrl.abort(), 5);

        try {
            await promise;
            expect.fail("expected CancellationError");
        } catch (err) {
            expect(err).to.be.instanceOf(CancellationError);
        }
    });

    test("re-throws spawn failures (binary not found) so the runner classifies as Errored", async () => {
        const env = makeSqlProjEnv();
        const enoent = Object.assign(new Error("ENOENT: sqlpackage not found"), {
            code: "ENOENT",
        });
        processes.respond("sqlpackage", "/Action:DeployReport", {
            mode: "throw",
            error: enoent,
        });

        try {
            await validator.run(
                env,
                {},
                { ...RUN_OPTS_BASE, signal: new AbortController().signal },
            );
            expect.fail("expected ENOENT to bubble up");
        } catch (err) {
            expect(err).to.equal(enoent);
        }
    });

    test("honors the sqlpackageCommand override on the validator constructor", async () => {
        const env = makeSqlProjEnv();
        const customValidator = new StaticAnalysisValidator(processes, {
            sqlpackageCommand: "/usr/local/bin/sqlpackage",
        });
        processes.respond("/usr/local/bin/sqlpackage", "/Action:DeployReport", {
            mode: "exit",
            exitCode: 0,
        });

        const result = await customValidator.run(
            env,
            {},
            { ...RUN_OPTS_BASE, signal: new AbortController().signal },
        );

        expect(result.status).to.equal(ValidationStatus.Passed);
        expect(processes.invocations[0].command).to.equal("/usr/local/bin/sqlpackage");
    });
});
