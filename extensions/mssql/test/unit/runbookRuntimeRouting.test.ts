/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { createFixtureRunbookArtifact } from "../../src/runbookStudio/runbookArtifact";
import {
    artifactRequiresExtensionRuntime,
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
                    version: 2,
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
        expect(artifactRequiresExtensionRuntime(artifact)).to.equal(true);
        expect(manifestRequiresExtensionPlanner(artifact.source.requirements)).to.equal(true);
    });

    test("keeps extension-native plans out of the Hobbes persistence translation path", () => {
        const artifact = createFixtureRunbookArtifact();
        artifact.lock!.nodes[0].activityKind = "database.schema.inventory";

        expect(artifactRequiresExtensionRuntime(artifact)).to.equal(true);

        artifact.lock!.nodes[0].activityKind = "sql.query.read";
        expect(artifactRequiresExtensionRuntime(artifact)).to.equal(false);
    });

    test("[artifact-folder-routing] keeps runtime-native control flow on Hobbes", () => {
        const artifact = createFixtureRunbookArtifact();
        artifact.lock!.libraryAssetRef = { assetId: artifact.id };
        artifact.lock!.nodes[0].activityKind = "hobbes.native";

        expect(artifactRequiresExtensionRuntime(artifact)).to.equal(false);
        expect(executionRuntimeKindForArtifact("hobbes", artifact)).to.equal("hobbes");
    });

    test("preserves explicit local and fake runtime selections", () => {
        const artifact = createFixtureRunbookArtifact();
        artifact.lock!.nodes[0].activityKind = "dacpac.extract";

        expect(executionRuntimeKindForArtifact("local", artifact)).to.equal("local");
        expect(executionRuntimeKindForArtifact("fake", artifact)).to.equal("fake");
    });
});
