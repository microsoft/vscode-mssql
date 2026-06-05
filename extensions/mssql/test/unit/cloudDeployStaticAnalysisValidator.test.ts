/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `StaticAnalysisValidator` (build-time DacFx analysis):
 *   * Skipped when sourceOfTruth is `Container` (no project to analyze).
 *   * Skipped when sourceOfTruth is `Dacpac` (pre-built — analysis ran at
 *     build time) without spawning a build.
 *   * Passed with zero findings when `dotnet build` exits 0 with no
 *     diagnostics.
 *   * Build args carry the project path and `/p:RunSqlCodeAnalysis=true`.
 *   * Failed when the build emits a `warning SQLnnnnn` diagnostic (static
 *     analysis is a gate — any DacFx diagnostic fails), with the source
 *     location parsed.
 *   * Failed when the build emits an `error SRnnnn`/`SQLnnnnn` diagnostic.
 *   * Repeated MSBuild diagnostic lines collapse to one finding; non-DacFx
 *     MSBuild codes (e.g. `MSB3277`) are ignored.
 *   * Failed with a synthesized finding when the build exits non-zero with
 *     no parseable DacFx diagnostics.
 *   * Cancellation pre-spawn / mid-spawn → `CancellationError`.
 *   * Spawn failure (binary not found) → re-thrown so the runner classifies
 *     as Errored.
 *   * `dotnetCommand` and `systemDacpacsLocation` overrides are honored.
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
const DACPAC_PATH = "/work/proj.dacpac";

function makeSqlProjEnv() {
    return makeEnvironmentWithValidations([], {
        sourceOfTruth: { kind: SourceOfTruthKind.SqlProj, path: PROJECT_PATH },
    });
}

function makeDacpacEnv() {
    return makeEnvironmentWithValidations([], {
        sourceOfTruth: { kind: SourceOfTruthKind.Dacpac, path: DACPAC_PATH },
    });
}

function freshSignal(): AbortSignal {
    return new AbortController().signal;
}

suite("CloudDeploy StaticAnalysisValidator", () => {
    let processes: FakeProcessProvider;
    let validator: StaticAnalysisValidator;

    setup(() => {
        processes = new FakeProcessProvider();
        validator = new StaticAnalysisValidator(processes);
    });

    test("returns Skipped for Container source-of-truth without spawning a build", async () => {
        const env = makeEnvironmentWithValidations([]); // default Container

        const result = await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: freshSignal() });

        expect(result.status).to.equal(ValidationStatus.Skipped);
        expect(result.validationId).to.equal(ValidationType.StaticAnalysis);
        expect(result.displayName).to.equal("Static Analysis");
        const payload = result.payload as StaticAnalysisPayload;
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0]).to.include({
            kind: "static-analysis",
            severity: "info",
            ruleId: "SOURCE_OF_TRUTH_UNSUPPORTED",
        });
        expect(processes.invocations).to.have.length(0);
    });

    test("returns Skipped for Dacpac source-of-truth without spawning a build", async () => {
        const env = makeDacpacEnv();

        const result = await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: freshSignal() });

        expect(result.status).to.equal(ValidationStatus.Skipped);
        const payload = result.payload as StaticAnalysisPayload;
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0]).to.include({
            kind: "static-analysis",
            severity: "info",
            ruleId: "DACPAC_PREBUILT",
        });
        expect(payload.findings[0].message).to.match(/build time/i);
        expect(processes.invocations).to.have.length(0);
    });

    test("returns Passed with zero findings when the build exits 0 cleanly", async () => {
        const env = makeSqlProjEnv();
        processes.respond("dotnet", "build", {
            mode: "exit",
            exitCode: 0,
            stdout: "Build succeeded.\n    0 Warning(s)\n    0 Error(s)\n",
        });

        const result = await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: freshSignal() });

        expect(result.status).to.equal(ValidationStatus.Passed);
        const payload = result.payload as StaticAnalysisPayload;
        expect(payload.findings).to.have.length(0);
        expect(payload.summary).to.deep.equal({ info: 0, warning: 0, error: 0 });
    });

    test("spawns dotnet build with the project path and code-analysis flag", async () => {
        const env = makeSqlProjEnv();
        processes.respond("dotnet", "build", { mode: "exit", exitCode: 0 });

        await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: freshSignal() });

        const invocation = processes.invocations[0];
        expect(invocation.command).to.equal("dotnet");
        expect(invocation.args[0]).to.equal("build");
        expect(invocation.args).to.include(PROJECT_PATH);
        expect(invocation.args).to.include("/p:RunSqlCodeAnalysis=true");
    });

    test("returns Failed for a build warning diagnostic, with the source location parsed", async () => {
        const env = makeSqlProjEnv();
        processes.respond("dotnet", "build", {
            mode: "exit",
            exitCode: 0,
            stdout: [
                "C:\\work\\proj\\Procedures\\GetCustomers.sql(9,10,9,10): Build warning SQL71502: Procedure: [dbo].[GetCustomers] has an unresolved reference to object [dbo].[NonExistentTable]. [C:\\work\\proj\\SmokeProject.sqlproj]",
                "Build succeeded.",
            ].join("\n"),
        });

        const result = await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: freshSignal() });

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as StaticAnalysisPayload;
        expect(payload.findings).to.have.length(1);
        const finding = payload.findings[0];
        expect(finding).to.include({
            kind: "static-analysis",
            severity: "warning",
            ruleId: "SQL71502",
        });
        expect(finding.message).to.match(/unresolved reference/);
        expect(finding.message).to.not.match(/\.sqlproj\]/);
        expect(finding.location).to.deep.equal({
            file: "C:\\work\\proj\\Procedures\\GetCustomers.sql",
            line: 9,
            column: 10,
        });
        expect(payload.summary).to.deep.equal({ info: 0, warning: 1, error: 0 });
    });

    test("returns Failed for an error-severity diagnostic", async () => {
        const env = makeSqlProjEnv();
        processes.respond("dotnet", "build", {
            mode: "exit",
            exitCode: 1,
            stdout: [
                "C:\\work\\proj\\Tables\\Bad.sql(1,1,1,1): Build error SQL46010: Incorrect syntax near GO. [C:\\work\\proj\\SmokeProject.sqlproj]",
                "Build FAILED.",
            ].join("\n"),
        });

        const result = await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: freshSignal() });

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as StaticAnalysisPayload;
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0]).to.include({
            severity: "error",
            ruleId: "SQL46010",
        });
        expect(payload.summary).to.deep.equal({ info: 0, warning: 0, error: 1 });
    });

    test("dedupes repeated diagnostics and ignores non-DacFx MSBuild codes", async () => {
        const env = makeSqlProjEnv();
        const diagnostic =
            "C:\\work\\proj\\Procedures\\GetCustomers.sql(9,10,9,10): Build warning SQL71502: unresolved reference. [C:\\work\\proj\\SmokeProject.sqlproj]";
        processes.respond("dotnet", "build", {
            mode: "exit",
            exitCode: 0,
            stdout: [
                diagnostic,
                "C:\\work\\proj\\SmokeProject.sqlproj : warning MSB3277: Found conflicts between assemblies.",
                diagnostic, // repeated in the MSBuild summary
            ].join("\n"),
        });

        const result = await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: freshSignal() });

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as StaticAnalysisPayload;
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0].ruleId).to.equal("SQL71502");
    });

    test("captures diagnostics across MSBuild subcategories (Build, StaticCodeAnalysis, {guid})", async () => {
        // MSBuild emits the same DacFx finding under several subcategory
        // prefixes; the parser must accept all of them so model-validation
        // (SQL) and code-analysis (SR) findings are both surfaced.
        const env = makeSqlProjEnv();
        processes.respond("dotnet", "build", {
            mode: "exit",
            exitCode: 0,
            stdout: [
                "C:\\work\\proj\\Procedures\\GetCustomers.sql(9,10,9,10): Build warning SQL71502: unresolved reference. [C:\\work\\proj\\SmokeProject.sqlproj]",
                "C:\\work\\proj\\Procedures\\GetCustomers.sql(8,12,8,12): StaticCodeAnalysis warning SR0001: Microsoft.Rules.Data : SELECT * usage. [C:\\work\\proj\\SmokeProject.sqlproj]",
                "C:\\work\\proj\\Procedures\\GetCustomers.sql(9,10,9,10): {5969ae36-de2c-4019-a31d-33e6691eb9e7} warning SQL71502: unresolved reference. [C:\\work\\proj\\SmokeProject.sqlproj]",
                "Build succeeded.",
            ].join("\n"),
        });

        const result = await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: freshSignal() });

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as StaticAnalysisPayload;
        const ruleIds = payload.findings.map((f) => f.ruleId).sort();
        expect(ruleIds).to.deep.equal(["SQL71502", "SR0001"]);
    });

    test("synthesizes a single error finding when failure has no parseable diagnostics", async () => {
        const env = makeSqlProjEnv();
        processes.respond("dotnet", "build", {
            mode: "exit",
            exitCode: 1,
            stderr: "MSB1009: Project file does not exist.",
        });

        const result = await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: freshSignal() });

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as StaticAnalysisPayload;
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0]).to.include({
            severity: "error",
            ruleId: "BUILD_FAILED",
        });
        expect(payload.findings[0].message).to.match(/exited with code 1/);
        expect(payload.findings[0].message).to.match(/MSB1009/);
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

    test("throws CancellationError when the build is aborted mid-flight", async () => {
        const env = makeSqlProjEnv();
        processes.respond("dotnet", "build", { mode: "hang" });
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
        const enoent = Object.assign(new Error("ENOENT: dotnet not found"), {
            code: "ENOENT",
        });
        processes.respond("dotnet", "build", { mode: "throw", error: enoent });

        try {
            await validator.run(env, {}, { ...RUN_OPTS_BASE, signal: freshSignal() });
            expect.fail("expected ENOENT to bubble up");
        } catch (err) {
            expect(err).to.equal(enoent);
        }
    });

    test("honors the dotnetCommand override on the validator constructor", async () => {
        const env = makeSqlProjEnv();
        const customValidator = new StaticAnalysisValidator(processes, {
            dotnetCommand: "/usr/local/bin/dotnet",
        });
        processes.respond("/usr/local/bin/dotnet", "build", { mode: "exit", exitCode: 0 });

        const result = await customValidator.run(
            env,
            {},
            { ...RUN_OPTS_BASE, signal: freshSignal() },
        );

        expect(result.status).to.equal(ValidationStatus.Passed);
        expect(processes.invocations[0].command).to.equal("/usr/local/bin/dotnet");
    });

    test("forwards systemDacpacsLocation into the build args when provided", async () => {
        const env = makeSqlProjEnv();
        const customValidator = new StaticAnalysisValidator(processes, {
            systemDacpacsLocation: "/ext/BuildDirectory",
        });
        processes.respond("dotnet", "build", { mode: "exit", exitCode: 0 });

        await customValidator.run(env, {}, { ...RUN_OPTS_BASE, signal: freshSignal() });

        expect(processes.invocations[0].args).to.include(
            "/p:SystemDacpacsLocation=/ext/BuildDirectory",
        );
    });
});
