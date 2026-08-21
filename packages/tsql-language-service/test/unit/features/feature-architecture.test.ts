/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const featureRoot = path.resolve(__dirname, "../../../src/features");

test("the feature facade delegates to independently owned providers", async () => {
    const [facade, navigation, renameReferences] = await Promise.all([
        readFile(path.join(featureRoot, "tsqlLanguageFeatureService.ts"), "utf8"),
        readFile(path.join(featureRoot, "navigationFeatures.ts"), "utf8"),
        readFile(path.join(featureRoot, "renameReferenceFeatures.ts"), "utf8"),
    ]);

    assert.match(facade, /RenameReferenceFeatureProvider/u);
    assert.doesNotMatch(navigation, /\b(?:references|prepareRename|rename)\s*\(/u);
    assert.match(renameReferences, /\breferences\s*\(/u);
    assert.match(renameReferences, /\bprepareRename\s*\(/u);
    assert.match(renameReferences, /\brename\s*\(/u);
});
