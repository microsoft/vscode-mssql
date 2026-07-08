/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";
import { QUERY_STUDIO_VIEW_TYPE } from "../../src/queryStudio/queryStudioEditorProvider";

suite("Query Studio activation contribution", () => {
    test("activates when VS Code restores or opens the custom editor", () => {
        const packageJsonPath = path.join(__dirname, "..", "..", "..", "package.json");
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
            activationEvents?: string[];
        };

        expect(packageJson.activationEvents).to.include(`onCustomEditor:${QUERY_STUDIO_VIEW_TYPE}`);
    });
});
