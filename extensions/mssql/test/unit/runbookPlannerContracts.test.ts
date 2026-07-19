/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    describePlannerContract,
    plannerContractFor,
    validateCompiledFamilyContract,
} from "../../src/runbookStudio/models/plannerContracts";
import { createFixtureRunbookArtifact } from "../../src/runbookStudio/runbookArtifact";

suite("Runbook Studio family planner contracts", () => {
    test("renders distinct Build, Validate, Investigate, and composed grammars", () => {
        for (const family of ["build", "validate", "investigate", "composed"] as const) {
            expect(describePlannerContract(family)).to.contain(`Planner family: ${family}`);
            expect(plannerContractFor(family).rules.length).to.be.greaterThan(1);
        }
        expect(describePlannerContract("build")).to.contain(
            "must never substitute for a workspace, DacFx, deployment, or cleanup operation",
        );
        expect(describePlannerContract("validate")).to.contain("deterministic assertion");
        expect(describePlannerContract("investigate")).to.contain("read-only");
        expect(describePlannerContract("composed")).to.contain("typed outputs between phases");
    });

    test("admits the reduced investigation fixture", () => {
        const artifact = createFixtureRunbookArtifact();
        artifact.family = "investigate";
        expect(validateCompiledFamilyContract(artifact)).to.deep.equal([]);
    });

    test("rejects missing required operations and report topology drift", () => {
        const artifact = createFixtureRunbookArtifact();
        artifact.family = "validate";
        artifact.source.requirements = {
            schemaVersion: 1,
            targets: [{ kind: "sqlDatabase", environment: "development" }],
            activities: [
                {
                    kind: "schema.compare",
                    version: 1,
                    host: "extension",
                    effect: "read",
                    approvalRequired: false,
                    connectionRequirement: "required",
                    secretRequirement: "none",
                    rollbackContract: "none",
                    outputContract: "schemaDiff/1",
                },
            ],
        };
        artifact.lock!.edges.push({ from: "report", to: "query" });
        expect(validateCompiledFamilyContract(artifact)).to.include.members([
            "required operation 'schema.compare' has no executable plan node",
            "the final report node cannot have outgoing edges",
        ]);
    });

    test("a Build plan cannot use a query as an operational substitute", () => {
        const artifact = createFixtureRunbookArtifact();
        artifact.family = "build";
        const issues = validateCompiledFamilyContract(artifact);
        expect(issues).to.include("family 'build' does not allow activity 'sql.query.read'");
        expect(issues).to.include(
            "build plans cannot substitute sql.query.read for a Build operation",
        );
    });
});
