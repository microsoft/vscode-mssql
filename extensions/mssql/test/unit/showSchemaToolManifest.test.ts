/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

suite("Show Schema LM tool manifest schema", () => {
    test("mssql_show_schema exists and is gated when DAB is disabled", () => {
        const packageJsonPath = path.join(__dirname, "..", "..", "..", "package.json");
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

        const tool = (packageJson.contributes?.languageModelTools ?? []).find(
            (t: any) => t?.name === "mssql_show_schema",
        );
        expect(tool, "missing mssql_show_schema tool in contributes.languageModelTools").to.exist;
        expect(tool.when).to.equal("!config.mssql.enableDAB");
    });
});
