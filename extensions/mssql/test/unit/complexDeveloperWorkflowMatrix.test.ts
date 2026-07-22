/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Capability truth table for the complex developer fixtures under
 * work2/test_assets/hobbes-complex-dev. A scenario is executable only when
 * every semantic operation has a registered activity; installed lower-level
 * primitives must never be presented as completion of a broader workflow. */

import { expect } from "chai";
import {
    buildDesignOnlyPlan,
    classifyRunbookIntent,
    preflightRunbookRequirements,
} from "../../src/runbookStudio/capabilities/runbookCapabilities";

const scenarios = [
    {
        id: "git-ef-rehearsal",
        prompt:
            "Compare development with main, analyze Entity Framework entity changes, generate migration DDL, " +
            "clone staging to a SQL Server 2025 Docker container, apply it, compare and visualize the schema, " +
            "run scripts/workload.sql with DMV and XEvent analysis, and produce a release candidate DACPAC.",
        missing: ["migration.script.generate@1"],
    },
    {
        id: "cities-generated-workload-with-dmv",
        prompt:
            "Sample 20 rows from WideWorldImporters Application.Cities, generate and run 1000 insert/delete " +
            "iterations in an owned SQL 2025 container, collect IO and blocking DMV and XEvent evidence, " +
            "and show performance metrics.",
        missing: [],
    },
    {
        id: "schema-evolution",
        prompt:
            "Extract WideWorldImporters database to a dacpac. Deploy the dacpac back to the same server as " +
            "WWI_2. Create a new table in WWI_2 that is dbo.Logs with representative logging columns. " +
            "Run a schema compare, export the schema diff, and visualize the new database schema as an ERD.",
        missing: [],
    },
    {
        id: "workload-regression",
        prompt:
            "Run scripts/workload.sql five times against an owned SQL container clone, capture XEvents and DMV " +
            "snapshots, compare the measurements with an approved baseline, and fail on regression.",
        missing: ["baseline.compare@1"],
    },
    {
        id: "migration-data-loss",
        prompt:
            "Compare Entity Framework changes on the development branch with main where a nullable column is " +
            "narrowed and a table is dropped, generate the migration DDL, analyze possible data loss, and stop " +
            "for an explicit decision before rehearsal.",
        missing: ["migration.script.generate@1", "migration.data-loss.analyze@1"],
    },
    {
        id: "target-drift",
        prompt:
            "Rehearse the approved migration, then detect schema drift after preview and refuse promotion to " +
            "staging while retaining comparison and release evidence.",
        missing: ["release.promote@1"],
    },
    {
        id: "capture-failure",
        prompt:
            "Run the workload when XEvent collection is incomplete, retain the partial XEL, return an " +
            "incomplete performance verdict, and clean up the owned SQL container.",
        missing: ["xevent.capture.reconcile@1"],
    },
    {
        id: "promotion-recovery",
        prompt:
            "Create a release manifest for the tested DACPAC, back up a staging target, promote the package, " +
            "inject a deployment failure, reconcile the target, and report rollback or operator attention.",
        missing: [
            "release.manifest.create@1",
            "database.backup@1",
            "release.promote@1",
            "deployment.reconcile@1",
        ],
    },
] as const;

suite("complex developer workflow capability matrix", () => {
    test("classifies eight scenarios without substituting installed lower-level activities", () => {
        expect(scenarios).to.have.length(8);
        for (const scenario of scenarios) {
            const classified = classifyRunbookIntent(scenario.prompt);
            const design = buildDesignOnlyPlan(classified);
            expect(
                design.steps.map((step) => step.activityKind),
                `${scenario.id} design grammar`,
            ).to.have.members(classified.requirements.activities.map((activity) => activity.kind));
            const readiness = preflightRunbookRequirements(classified.requirements);
            if (scenario.missing.length === 0) {
                expect(readiness.status, scenario.id).to.equal("readyAfterBinding");
                expect(readiness.missingActivityKinds, scenario.id).to.deep.equal([]);
            } else {
                expect(readiness.status, scenario.id).to.equal("designOnly");
                expect(readiness.missingActivityKinds, scenario.id).to.include.members(
                    scenario.missing,
                );
            }
        }
    });

    test("keeps the exact Cities workflow executable with factual DMV evidence", () => {
        const classified = classifyRunbookIntent(
            "Sample 20 rows from WideWorldImporters Application.Cities, generate a workload with 1000 " +
                "insert/delete iterations, collect server statistics around IO and blocking with XEvents, " +
                "and present performance activity metrics.",
        );
        const readiness = preflightRunbookRequirements(classified.requirements);
        expect(readiness.status).to.equal("readyAfterBinding");
        expect(readiness.missingActivityKinds).to.deep.equal([]);
        expect(classified.requirements.activities.map((activity) => activity.kind)).to.include(
            "performance.dmv.snapshot",
        );
        expect(classified.requirements.activities.map((activity) => activity.kind)).to.include(
            "database.schema.fingerprint",
        );
    });
});
