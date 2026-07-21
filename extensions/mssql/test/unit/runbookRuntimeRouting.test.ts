/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { createFixtureRunbookArtifact } from "../../src/runbookStudio/runbookArtifact";
import {
    executionRuntimeKindForArtifact,
    manifestRequiresExtensionPlanner,
} from "../../src/runbookStudio/runtime/runbookRuntimeRouting";

suite("runbookRuntimeRouting", () => {
    test("keeps Hobbes authority for its translated SQL activity subset", () => {
        const artifact = createFixtureRunbookArtifact();

        expect(executionRuntimeKindForArtifact("hobbes", artifact)).to.equal("hobbes");
        expect(manifestRequiresExtensionPlanner(artifact.source.requirements)).to.equal(false);
    });

    test("routes extension-native DacFx locks to the governed local executor", () => {
        const artifact = createFixtureRunbookArtifact();
        artifact.lock!.nodes[0].activityKind = "dacpac.extract";
        artifact.source.requirements = {
            schemaVersion: 1,
            targets: [{ kind: "sqlDatabase", environment: "development" }],
            activities: [
                {
                    kind: "dacpac.extract",
                    version: 1,
                    host: "extension",
                    effect: "mutate",
                    approvalRequired: false,
                    connectionRequirement: "required",
                    secretRequirement: "none",
                    rollbackContract: "automatic",
                    outputContract: "dacpacArtifact/1",
                },
            ],
        };

        expect(executionRuntimeKindForArtifact("hobbes", artifact)).to.equal("local");
        expect(manifestRequiresExtensionPlanner(artifact.source.requirements)).to.equal(true);
    });

    test("preserves explicit local and fake runtime selections", () => {
        const artifact = createFixtureRunbookArtifact();
        artifact.lock!.nodes[0].activityKind = "dacpac.extract";

        expect(executionRuntimeKindForArtifact("local", artifact)).to.equal("local");
        expect(executionRuntimeKindForArtifact("fake", artifact)).to.equal("fake");
    });
});
