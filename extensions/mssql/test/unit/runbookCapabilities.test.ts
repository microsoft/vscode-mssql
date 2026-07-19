/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    classifyRunbookIntent,
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
        expect(readiness.missingActivityKinds).to.include("dacpac.build@1");
        expect(readiness.missingActivityKinds).to.not.include("sql.query.read@1");

        const prepared = prepareRunbookIntent(
            createFixtureRunbookArtifact(),
            "Create a database project and build a DACPAC",
        );
        expect(prepared.artifact.family).to.equal("build");
        expect(prepared.artifact.lock).to.equal(undefined);
        expect(
            prepared.artifact.source.requirements?.activities.map((activity) => activity.kind),
        ).to.include("dacpac.build");
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
            "sqltest.run",
            "evidence.bundle",
        ]);
        expect(preflightRunbookRequirements(classified.requirements).status).to.equal("designOnly");
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
        });
        expect(
            prepareRunbookIntent(
                createFixtureRunbookArtifact(),
                "Inspect developer database health and summarize current readiness.",
            ).artifact.lock,
        ).not.to.equal(undefined);
    });
});
