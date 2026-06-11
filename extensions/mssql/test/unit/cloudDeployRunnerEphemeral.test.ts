/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for the Scope 2 ephemeral-database orchestration in the validation
 * `Runner` (decisions D-A / D-C / D-D / M5 / M6). Covers:
 *   * provisions ONE ephemeral database when a runtime validator is enabled and
 *     passes its connection to the validators.
 *   * does NOT provision for a static-analysis-only run.
 *   * seeds via the data generator when the env declares a script.
 *   * stamps the run's `sourceVersion` from the schema hasher.
 *   * always disposes the ephemeral database after the run.
 *   * a provisioning failure surfaces runtime validators as `Errored` while
 *     non-runtime validators still run, and the run is not aborted.
 */

import { expect } from "chai";

import { SourceOfTruthKind, ValidationType } from "../../src/cloudDeploy/environments/types";
import { ValidationStatus } from "../../src/cloudDeploy/runs/types";
import { SchemaHasher, SchemaSourceReader } from "../../src/cloudDeploy/runs/schemaHasher";
import {
    ConnectionHandle,
    DataGenerator,
    FakeEphemeralDatabaseProvider,
    Runner,
} from "../../src/cloudDeploy/validation";

import {
    makeEnvironmentWithValidations,
    makeFakeRegistry,
    makeValidationConfig,
} from "./cloudDeployValidationTestHelpers";

class RecordingConnectionHandle implements ConnectionHandle {
    public async execute(): Promise<unknown[][]> {
        return [];
    }
    public async dispose(): Promise<void> {
        // no-op
    }
}

/** Records seed calls; optionally throws to exercise the seed-failure path. */
class FakeDataGenerator implements DataGenerator {
    public readonly seeded: Array<{ scriptPath: string }> = [];
    public failWith?: Error;
    public async seed(
        _connection: ConnectionHandle,
        scriptPath: string,
        _signal: AbortSignal,
    ): Promise<void> {
        if (this.failWith) {
            throw this.failWith;
        }
        this.seeded.push({ scriptPath });
    }
}

/** A real `SchemaHasher` over a fake reader returning one fixed file. */
function fixedHasher(): SchemaHasher {
    const reader: SchemaSourceReader = {
        async listSqlProjFiles() {
            return [{ relativePath: "a.sql", content: Buffer.from("SELECT 1;", "utf-8") }];
        },
        async readFileBuffer() {
            return Buffer.from("SELECT 1;", "utf-8");
        },
    };
    return new SchemaHasher(reader);
}

const SQLPROJ_OVERRIDE = {
    sourceOfTruth: { kind: SourceOfTruthKind.SqlProj as const, path: "db/P/P.sqlproj" },
};

suite("CloudDeploy Validation Runner — ephemeral database", () => {
    test("provisions an ephemeral DB and passes its connection to a runtime validator", async () => {
        const { registry, unitTests } = makeFakeRegistry();
        const connection = new RecordingConnectionHandle();
        const provider = new FakeEphemeralDatabaseProvider(connection);
        const env = makeEnvironmentWithValidations(
            [makeValidationConfig(ValidationType.UnitTests)],
            SQLPROJ_OVERRIDE,
        );

        await new Runner(registry, undefined, { ephemeralProvider: provider }).run(env);

        expect(provider.invocations).to.have.lengthOf(1);
        expect(unitTests.invocations).to.have.lengthOf(1);
    });

    test("does NOT provision for a static-analysis-only run", async () => {
        const { registry } = makeFakeRegistry();
        const provider = new FakeEphemeralDatabaseProvider(new RecordingConnectionHandle());
        const env = makeEnvironmentWithValidations(
            [makeValidationConfig(ValidationType.StaticAnalysis)],
            SQLPROJ_OVERRIDE,
        );

        await new Runner(registry, undefined, { ephemeralProvider: provider }).run(env);

        expect(provider.invocations).to.have.lengthOf(0);
    });

    test("seeds via the data generator when the env declares a script", async () => {
        const { registry } = makeFakeRegistry();
        const provider = new FakeEphemeralDatabaseProvider(new RecordingConnectionHandle());
        const dataGenerator = new FakeDataGenerator();
        const env = makeEnvironmentWithValidations(
            [makeValidationConfig(ValidationType.WorkloadPlayback)],
            { ...SQLPROJ_OVERRIDE, dataGeneratorScript: "datagen.sql" },
        );

        await new Runner(registry, undefined, { ephemeralProvider: provider, dataGenerator }).run(
            env,
        );

        expect(dataGenerator.seeded).to.deep.equal([{ scriptPath: "datagen.sql" }]);
    });

    test("does not seed when the env declares no script", async () => {
        const { registry } = makeFakeRegistry();
        const provider = new FakeEphemeralDatabaseProvider(new RecordingConnectionHandle());
        const dataGenerator = new FakeDataGenerator();
        const env = makeEnvironmentWithValidations(
            [makeValidationConfig(ValidationType.UnitTests)],
            SQLPROJ_OVERRIDE,
        );

        await new Runner(registry, undefined, { ephemeralProvider: provider, dataGenerator }).run(
            env,
        );

        expect(dataGenerator.seeded).to.have.lengthOf(0);
    });

    test("stamps the run's sourceVersion from the schema hasher", async () => {
        const { registry } = makeFakeRegistry();
        const env = makeEnvironmentWithValidations(
            [makeValidationConfig(ValidationType.StaticAnalysis)],
            SQLPROJ_OVERRIDE,
        );

        const record = await new Runner(registry, undefined, {
            schemaHasher: fixedHasher(),
        }).run(env);

        expect(record.sourceVersion?.algorithm).to.equal("sha256");
        expect(record.sourceVersion?.hash).to.match(/^sha256:[0-9a-f]{64}$/);
    });

    test("leaves sourceVersion unset when no hasher is wired", async () => {
        const { registry } = makeFakeRegistry();
        const env = makeEnvironmentWithValidations([
            makeValidationConfig(ValidationType.StaticAnalysis),
        ]);

        const record = await new Runner(registry).run(env);

        expect(record.sourceVersion).to.equal(undefined);
    });

    test("always disposes the ephemeral database after the run", async () => {
        const { registry } = makeFakeRegistry();
        const provider = new FakeEphemeralDatabaseProvider(new RecordingConnectionHandle());
        const env = makeEnvironmentWithValidations(
            [makeValidationConfig(ValidationType.UnitTests)],
            SQLPROJ_OVERRIDE,
        );

        await new Runner(registry, undefined, { ephemeralProvider: provider }).run(env);

        expect(provider.databases).to.have.lengthOf(1);
        expect(provider.databases[0].disposed).to.equal(true);
    });

    test("a provisioning failure errors the runtime validator but still runs static analysis", async () => {
        const { registry, staticAnalysis } = makeFakeRegistry();
        const provider = new FakeEphemeralDatabaseProvider();
        provider.failWith = new Error("docker not running");
        const env = makeEnvironmentWithValidations(
            [
                makeValidationConfig(ValidationType.StaticAnalysis),
                makeValidationConfig(ValidationType.UnitTests),
            ],
            SQLPROJ_OVERRIDE,
        );

        const record = await new Runner(registry, undefined, { ephemeralProvider: provider }).run(
            env,
        );

        const unit = record.validations.find((v) => v.validationId === ValidationType.UnitTests);
        expect(unit?.status).to.equal(ValidationStatus.Errored);
        expect(unit?.errorMessage).to.contain("docker not running");
        // Static analysis is not a runtime validator, so it still executed.
        expect(staticAnalysis.invocations).to.have.lengthOf(1);
    });
});
