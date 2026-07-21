/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    buildDesignOnlyPlan,
    classifyRunbookIntent,
    preflightContextForRuntime,
    preflightRunbookRequirements,
    prepareRunbookIntent,
} from "../../src/runbookStudio/capabilities/runbookCapabilities";
import { createFixtureRunbookArtifact } from "../../src/runbookStudio/runbookArtifact";

function activityKinds(intent: string): string[] {
    return classifyRunbookIntent(intent).requirements.activities.map((activity) => activity.kind);
}

suite("runbook capability preflight", () => {
    test("B01 project scaffold is design-only with named Build activities", () => {
        const classified = classifyRunbookIntent(
            "Create a database project; add Customer and Order tables with PK/FK/indexes; " +
                "build a DACPAC; provision an isolated local target; deploy; verify; report with evidence.",
        );

        expect(classified.family).to.equal("build");
        expect(classified.requirements.activities.map((activity) => activity.kind)).to.deep.equal([
            "workspace.inspect",
            "dbproject.create",
            "dbproject.add-object",
            "dacpac.build",
            "sandbox.provision",
            "sandbox.dispose",
            "dacpac.deploy.preview",
            "dacpac.deploy",
            "schema.compare",
            "evidence.bundle",
        ]);
        const readiness = preflightRunbookRequirements(classified.requirements);
        expect(readiness.status).to.equal("designOnly");
        expect(readiness.missingActivityKinds).to.include("dbproject.create@1");
        expect(readiness.missingActivityKinds).to.not.include("dacpac.build@1");
        expect(readiness.missingActivityKinds).to.not.include("sql.query.read@1");

        const prepared = prepareRunbookIntent(
            createFixtureRunbookArtifact(),
            "Create a database project and build a DACPAC",
        );
        expect(prepared.artifact.family).to.equal("build");
        expect(prepared.artifact.lock).to.equal(undefined);
        expect(prepared.artifact.source.design?.family).to.equal("build");
        expect(
            prepared.artifact.source.design?.steps.map((step) => step.activityKind),
        ).to.deep.equal(["workspace.inspect", "dbproject.create", "dacpac.build"]);
        expect(
            prepared.artifact.source.requirements?.activities.map((activity) => activity.kind),
        ).to.include("dacpac.build");
    });

    test("B01 design grammar makes cleanup the last external effect before evidence", () => {
        const classified = classifyRunbookIntent(
            "Create a database project; add tables; build a DACPAC; provision an isolated local target; deploy; verify; report with evidence.",
        );
        const design = buildDesignOnlyPlan(classified);
        const kinds = design.steps.map((step) => step.activityKind);

        expect(kinds).to.deep.equal([
            "workspace.inspect",
            "dbproject.create",
            "dbproject.add-object",
            "dacpac.build",
            "sandbox.provision",
            "dacpac.deploy.preview",
            "dacpac.deploy",
            "schema.compare",
            "sandbox.dispose",
            "evidence.bundle",
        ]);
        expect(kinds).not.to.include("sql.query.read");
        expect(design.steps[0].dependsOn).to.deep.equal([]);
        expect(design.steps.at(-1)?.dependsOn).to.deep.equal(["design-sandbox-dispose"]);
    });

    test("executable investigation preparation removes a stale design outline", () => {
        const artifact = createFixtureRunbookArtifact();
        artifact.source.design = buildDesignOnlyPlan(
            classifyRunbookIntent("Create a database project and build a DACPAC"),
        );

        const prepared = prepareRunbookIntent(
            artifact,
            "Inspect developer database health and summarize current readiness.",
        );
        expect(prepared.readiness.status).to.equal("readyAfterBinding");
        expect(prepared.artifact.source.design).to.equal(undefined);
    });

    test("V02 pre-merge verification requests build, test, and evidence capabilities", () => {
        const classified = classifyRunbookIntent(
            "Run a full pre-merge quality gate: build the DACPAC, provision a sandbox, deploy, " +
                "run SQL tests, compare schema drift, and publish an evidence bundle for CI/CD.",
        );

        expect(classified.family).to.equal("validate");
        expect(
            classified.requirements.activities.map((activity) => activity.kind),
        ).to.include.members([
            "dacpac.build",
            "sandbox.provision",
            "sandbox.dispose",
            "dacpac.deploy.preview",
            "dacpac.deploy",
            "schema.compare",
            "sqltest.discover",
            "sqltest.run",
            "evidence.bundle",
        ]);
        expect(preflightRunbookRequirements(classified.requirements).status).to.equal(
            "readyAfterBinding",
        );
    });

    test("explicit tSQLt validation selects governed discovery and execution", () => {
        const classified = classifyRunbookIntent(
            "Run the OrderTests tSQLt suite in a disposable sandbox and retain evidence.",
        );
        const kinds = classified.requirements.activities.map((activity) => activity.kind);

        expect(classified.family).to.equal("validate");
        expect(kinds).to.include.members(["sqltest.discover", "tsqlt.run", "evidence.bundle"]);
        expect(kinds).not.to.include("sqltest.run");
        const execution = classified.requirements.activities.find(
            (activity) => activity.kind === "tsqlt.run",
        );
        expect(execution).to.deep.include({
            effect: "mutate",
            approvalRequired: true,
            connectionRequirement: "provisioned",
            rollbackContract: "automatic",
            outputContract: "testResults/1",
        });
    });

    test("cross-family authoring plus validation routes to composed", () => {
        const classified = classifyRunbookIntent(
            "Create a database project and tables, then run SQL tests and investigate blocking against the deployed sandbox.",
        );
        expect(classified.family).to.equal("composed");
        expect(
            classified.requirements.activities.map((activity) => activity.kind),
        ).to.include.members([
            "workspace.inspect",
            "dbproject.create",
            "dbproject.add-object",
            "sqltest.run",
        ]);
        const design = buildDesignOnlyPlan(classified);
        expect(design.family).to.equal("composed");
        expect(design.steps[0].activityKind).to.equal("workspace.inspect");
        expect(design.steps.at(-1)?.activityKind).to.equal("sandbox.dispose");
        expect(design.steps.map((step) => step.activityKind)).not.to.include("sql.query.read");
    });

    test("V17 and I01 regression prompts require benchmark and baseline comparison", () => {
        for (const intent of [
            "Detect a performance regression in this workload benchmark.",
            "Investigate a query latency regression against the approved baseline.",
        ]) {
            expect(activityKinds(intent)).to.include.members([
                "workload.benchmark",
                "baseline.compare",
            ]);
            expect(
                preflightRunbookRequirements(classifyRunbookIntent(intent).requirements).status,
            ).to.equal("designOnly");
        }
    });

    test("I25 read-only health remains on the installed investigation lane", () => {
        const classified = classifyRunbookIntent(
            "Inspect developer database health and summarize current readiness.",
        );

        expect(classified.family).to.equal("investigate");
        expect(
            activityKinds("Inspect developer database health and summarize current readiness."),
        ).to.deep.equal(["sql.query.read"]);
        expect(preflightRunbookRequirements(classified.requirements)).to.deep.equal({
            status: "readyAfterBinding",
            missingActivityKinds: [],
            issues: [
                {
                    dimension: "binding",
                    code: "binding.connectionRequired",
                    message: "Activity 'sql.query.read' needs a bound SQL connection.",
                    activityKind: "sql.query.read@1",
                },
            ],
        });
        expect(
            prepareRunbookIntent(
                createFixtureRunbookArtifact(),
                "Inspect developer database health and summarize current readiness.",
            ).artifact.lock,
        ).not.to.equal(undefined);
    });

    test("a compatible bound read plan is ready", () => {
        const manifest = classifyRunbookIntent("Inspect database health").requirements;
        expect(
            preflightRunbookRequirements(manifest, {
                phase: "admission",
                host: "extension",
                hostVersion: "1.45.0",
                allowedEffects: ["read"],
                availableTargetKinds: ["sqlDatabase"],
                supportedRollbackContracts: ["none"],
                bindings: { connection: true },
            }),
        ).to.deep.equal({ status: "ready", missingActivityKinds: [] });
    });

    test("host, provider, and output compatibility produce incompatible outcomes", () => {
        const manifest = classifyRunbookIntent("Inspect database health").requirements;
        manifest.activities[0].minimumHostVersion = "2.0.0";
        manifest.activities[0].providerRequirement = "execution";
        manifest.activities[0].outputContract = "rowset/2";

        const readiness = preflightRunbookRequirements(manifest, {
            phase: "admission",
            host: "hobbes",
            hostVersion: "1.9.0",
            providerAvailable: false,
            bindings: { connection: true },
        });
        expect(readiness.status).to.equal("incompatible");
        expect(readiness.issues?.map((issue) => issue.code)).to.include.members([
            "host.unsupported",
            "host.versionIncompatible",
            "provider.unavailable",
            "output.contractIncompatible",
        ]);
    });

    test("policy denial is distinct from missing capability and binding", () => {
        const manifest = classifyRunbookIntent("Inspect database health").requirements;
        manifest.activities[0].effect = "mutate";
        manifest.activities[0].approvalRequired = true;

        const readiness = preflightRunbookRequirements(manifest, {
            allowedEffects: ["read"],
            approvalSupported: false,
            bindings: { connection: true },
        });
        expect(readiness.status).to.equal("policyBlocked");
        expect(readiness.issues?.map((issue) => issue.dimension)).to.have.members([
            "policy",
            "approval",
        ]);
    });

    test("target availability is bindable while authoring and incompatible at admission", () => {
        const manifest = classifyRunbookIntent("Inspect database health").requirements;
        const authoring = preflightRunbookRequirements(manifest, {
            availableTargetKinds: [],
            bindings: { connection: true },
        });
        expect(authoring.status).to.equal("readyAfterBinding");
        expect(authoring.issues?.[0].code).to.equal("target.unavailable");

        const admission = preflightRunbookRequirements(manifest, {
            phase: "admission",
            availableTargetKinds: [],
            bindings: { connection: true },
        });
        expect(admission.status).to.equal("incompatible");
    });

    test("developer sandbox activities are admitted by fake and guarded local lanes", () => {
        const manifest = classifyRunbookIntent(
            "Build a DACPAC and provision an ephemeral sandbox.",
        ).requirements;
        const local = preflightRunbookRequirements(manifest, preflightContextForRuntime("local"));
        expect(local.status).to.equal("readyAfterBinding");
        expect(local.issues?.map((issue) => issue.code)).to.not.include("activity.previewOnly");

        const localAdmission = preflightRunbookRequirements(manifest, {
            ...preflightContextForRuntime("local", "admission"),
            providerAvailable: true,
            bindings: { connection: true, provisionedTarget: true },
        });
        expect(localAdmission.status).to.equal("ready");

        const fake = preflightRunbookRequirements(manifest, {
            ...preflightContextForRuntime("fake", "admission"),
            bindings: { connection: true, provisionedTarget: true },
        });
        expect(fake.status).to.equal("ready");
    });

    test("local runtime admits the real workspace and DACPAC build prefix", () => {
        const manifest = classifyRunbookIntent("Build this database project DACPAC.").requirements;
        const local = preflightRunbookRequirements(manifest, {
            ...preflightContextForRuntime("local", "admission"),
            providerAvailable: true,
        });

        expect(manifest.activities.map((activity) => activity.kind)).to.deep.equal([
            "workspace.inspect",
            "dacpac.build",
        ]);
        expect(local.status).to.equal("ready");
        expect(local.issues ?? []).to.deep.equal([]);
    });

    test("local DACPAC build reports a missing SQL Projects provider", () => {
        const manifest = classifyRunbookIntent("Build this database project DACPAC.").requirements;
        const local = preflightRunbookRequirements(manifest, {
            ...preflightContextForRuntime("local", "admission"),
            providerAvailable: false,
        });

        expect(local.status).to.equal("incompatible");
        expect(local.issues?.map((issue) => issue.code)).to.include("provider.unavailable");
    });

    test("read-only deployment preview is executable without enabling deployment", () => {
        const manifest = classifyRunbookIntent(
            "Generate a deployment preview report for this database project.",
        ).requirements;
        const kinds = manifest.activities.map((activity) => activity.kind);
        const local = preflightRunbookRequirements(manifest, {
            ...preflightContextForRuntime("local", "admission"),
            providerAvailable: true,
            bindings: { connection: true },
        });

        expect(kinds).to.deep.equal(["workspace.inspect", "dacpac.build", "dacpac.deploy.preview"]);
        expect(kinds).to.not.include("dacpac.deploy");
        expect(local.status).to.equal("ready");
    });

    test("an actual deployment is admitted only with guarded local bindings", () => {
        const manifest = classifyRunbookIntent("Deploy this database project.").requirements;
        const local = preflightRunbookRequirements(manifest, {
            ...preflightContextForRuntime("local", "admission"),
            providerAvailable: true,
            bindings: { connection: true, provisionedTarget: true },
        });

        expect(manifest.activities.map((activity) => activity.kind)).to.include("dacpac.deploy");
        expect(manifest.activities.map((activity) => activity.kind)).to.include("schema.compare");
        expect(local.status).to.equal("ready");
        expect(local.missingActivityKinds).to.deep.equal([]);
    });

    test("databaseToDacpacCapabilities has a complete executable activity stack", () => {
        const classified = classifyRunbookIntent(
            "Create a dacpac from WideWorldImporters, then import the dacpac into WWI_2, " +
                "then create a table in WWI_2, then run a schema compare and create a diff file.",
        );
        const kinds = classified.requirements.activities.map((activity) => activity.kind);
        const readiness = preflightRunbookRequirements(classified.requirements);

        expect(classified.family).to.equal("composed");
        expect(kinds).to.deep.equal([
            "dacpac.extract",
            "sql.schema.apply",
            "dacpac.deploy.preview",
            "devdatabase.provision",
            "dacpac.deploy.dev",
            "schema.compare.export",
        ]);
        expect(kinds).not.to.include("workspace.inspect");
        expect(kinds).not.to.include("dbproject.add-object");
        expect(kinds).not.to.include("dacpac.build");
        expect(readiness.status).to.equal("readyAfterBinding");
        expect(readiness.missingActivityKinds).to.deep.equal([]);

        expect(
            buildDesignOnlyPlan(classified).steps.map((step) => step.activityKind),
        ).to.deep.equal([
            "dacpac.extract",
            "devdatabase.provision",
            "dacpac.deploy.preview",
            "dacpac.deploy.dev",
            "sql.schema.apply",
            "schema.compare.export",
        ]);
    });

    test("containerWorkloadCapabilities admits the complete owned capture lifecycle", () => {
        const classified = classifyRunbookIntent(
            "Provision a local SQL container, import the dacpac, run this workload.sql, " +
                "and collect an XEvent XEL file.",
        );
        const kinds = classified.requirements.activities.map((activity) => activity.kind);
        const readiness = preflightRunbookRequirements(classified.requirements);

        expect(kinds).to.include.members([
            "sql.container.provision",
            "dacpac.deploy.preview",
            "dacpac.deploy.container",
            "xevent.session.start",
            "sql.workload.inspect",
            "sql.workload.run",
            "xevent.session.stop",
            "xevent.xel.collect",
            "sql.container.dispose",
        ]);
        expect(kinds).not.to.include("sandbox.provision");
        expect(kinds).not.to.include("dacpac.deploy");
        expect(kinds).not.to.include("workspace.inspect");
        expect(kinds).not.to.include("dacpac.build");
        expect(readiness.status).to.equal("readyAfterBinding");
        expect(readiness.missingActivityKinds).to.deep.equal([]);
        expect(readiness.missingActivityKinds).not.to.include.members([
            "sql.container.provision@1",
            "dacpac.deploy.container@1",
            "sql.workload.inspect@1",
            "sql.workload.run@1",
            "xevent.session.start@1",
            "xevent.session.stop@1",
            "xevent.xel.collect@1",
            "sql.container.dispose@1",
        ]);
    });

    test("extract, named deploy, and schema inventory is executable after binding", () => {
        const classified = classifyRunbookIntent(
            "Extract a dacpac from WideWorldImporters and deploy it as WWI_2. " +
                "Show all the tables, views, and sproc from the new database.",
        );
        const kinds = classified.requirements.activities.map((activity) => activity.kind);
        const readiness = preflightRunbookRequirements(classified.requirements);

        expect(classified.family).to.equal("build");
        expect(kinds).to.deep.equal([
            "dacpac.extract",
            "dacpac.deploy.preview",
            "devdatabase.provision",
            "dacpac.deploy.dev",
            "schema.compare",
            "database.schema.inventory",
        ]);
        expect(kinds).not.to.include("sql.query.read");
        expect(readiness.status).to.equal("readyAfterBinding");
        expect(readiness.missingActivityKinds).to.deep.equal([]);
        expect(
            buildDesignOnlyPlan(classified).steps.map((step) => step.activityKind),
        ).to.deep.equal([
            "dacpac.extract",
            "devdatabase.provision",
            "dacpac.deploy.preview",
            "dacpac.deploy.dev",
            "schema.compare",
            "database.schema.inventory",
        ]);
    });

    test("recognizes the authored extract typo and dump vocabulary from the UI repro", () => {
        const classified = classifyRunbookIntent(
            "Exact WideWorldImporter to a dacpac. Deploy the dacpac back to server as WWI_2. " +
                "Dump all the tables, views, and sproc from WWI_2 into a grid.",
        );

        expect(classified.family).to.equal("build");
        expect(classified.requirements.activities.map((activity) => activity.kind)).to.deep.equal([
            "dacpac.extract",
            "dacpac.deploy.preview",
            "devdatabase.provision",
            "dacpac.deploy.dev",
            "schema.compare",
            "database.schema.inventory",
        ]);
        expect(classified.requirements.targets.map((target) => target.kind)).to.deep.equal([
            "sqlDatabase",
        ]);
        expect(
            classified.requirements.activities.find(
                (activity) => activity.kind === "dacpac.extract",
            )?.version,
        ).to.equal(2);
    });
});
