/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { InMemoryMetadataProvider } from "@vscode-mssql/tsql-language-service";
import { createPreviewAnalysisServices } from "../../src/languageservice/preview/previewLanguageService";

suite("Preview source-mapped analysis route", () => {
    // Exercises the same service composition used by the registered VS Code providers. Directive
    // text is deliberately longer than the projected newline so an offset fallback would address
    // unrelated SQL and make this fail visibly.
    test("keeps SQLCMD directive offsets out of extension feature requests", async () => {
        const uri = "file:///preview-source-map.sql";
        const sql = ":setvar ignored long-value\nSELECT Id FROM dbo.Customers;";
        const metadata = new InMemoryMetadataProvider({
            environment: { currentDatabase: "db", defaultSchema: "dbo" },
            databases: [{ name: "db" }],
            schemas: [{ database: "db", name: "dbo" }],
            objects: [
                {
                    ref: { id: "customers", database: "db" },
                    database: "db",
                    schema: "dbo",
                    name: "Customers",
                    kind: "table",
                },
            ],
            columns: new Map([
                ["customers", [{ name: "Id", typeDisplay: "int", nullable: false }]],
            ]),
        });
        const services = createPreviewAnalysisServices(metadata);
        await services.runtime.open(uri, 1, sql);

        const directiveOffset = sql.indexOf("ignored");
        expect(services.features.completion(uri, 1, directiveOffset)).to.deep.equal({
            items: [],
            incomplete: false,
        });
        expect(services.features.hover(uri, 1, directiveOffset)).to.equal(undefined);

        const tableOffset = sql.indexOf("Customers") + 1;
        expect(services.features.hover(uri, 1, tableOffset)?.markdown).to.contain("Customers");
    });
});
