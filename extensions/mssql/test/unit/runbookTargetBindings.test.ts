/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { createFixtureRunbookArtifact } from "../../src/runbookStudio/runbookArtifact";
import { createDeveloperValidationPreviewArtifact } from "../../src/runbookStudio/developerValidationPreview";
import { validateTargetBindings } from "../../src/runbookStudio/targetBindings";

suite("Runbook Studio target bindings", () => {
    test("admits a typed SQL target with a bound connection", () => {
        expect(
            validateTargetBindings(createFixtureRunbookArtifact(), { target: "profile-1" }),
        ).to.deep.equal([]);
    });

    test("refuses missing targets and values without logging values", () => {
        const missingTarget = createFixtureRunbookArtifact();
        delete missingTarget.lock!.nodes[0].target;
        expect(
            validateTargetBindings(missingTarget, { target: "secret-profile-id" }),
        ).to.deep.equal([
            {
                kind: "missingTarget",
                nodeId: "query",
                detail: "node 'query' has no explicit target",
            },
        ]);

        const missingValue = validateTargetBindings(createFixtureRunbookArtifact(), {});
        expect(missingValue.map((issue) => issue.kind)).to.deep.equal(["valueMissing"]);
        expect(JSON.stringify(missingValue)).not.to.contain("secret-profile-id");
    });

    test("refuses target parameter type and catalog-input mismatches", () => {
        const artifact = createFixtureRunbookArtifact();
        artifact.source.parameters[0].type = "string";
        artifact.lock!.nodes[0].inputs!.connection = "$params.maxCount";

        const issues = validateTargetBindings(artifact, { target: "profile-1", maxCount: 100 });
        expect(issues.map((issue) => issue.kind)).to.have.members([
            "catalogMismatch",
            "parameterTypeInvalid",
        ]);
    });

    test("refuses target kinds absent from a declared manifest", () => {
        const artifact = createFixtureRunbookArtifact();
        artifact.source.requirements = {
            schemaVersion: 1,
            targets: [{ kind: "workspace", environment: "local" }],
            activities: [],
        };
        expect(validateTargetBindings(artifact, { target: "profile-1" })[0].kind).to.equal(
            "manifestMismatch",
        );
    });

    test("admits workspace, parameter, and upstream-output targets in the preview chain", () => {
        expect(
            validateTargetBindings(createDeveloperValidationPreviewArtifact(), {
                projectPath: "Database.sqlproj",
                sandboxConnection: "preview-profile",
            }),
        ).to.deep.equal([]);
    });
});
