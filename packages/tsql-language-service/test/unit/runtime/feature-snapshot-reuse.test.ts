/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    type MetadataProvider,
    type ProfileAwareSyntaxService,
    type SemanticBinder,
    TsqlColorizationService,
    TsqlLanguageFeatureService,
} from "../../../src/index.ts";

suite("published analysis snapshot reuse", () => {
    // Every editor feature reads the parse, bind, and metadata view published by open. None may
    // hide a first-request parse, bind, or catalog pin that warm benchmarks would omit.
    test("serves all features without reparsing, rebinding, or repinning metadata", async () => {
        const innerSyntax = new LezerSyntaxService();
        let parses = 0;
        let syntaxUpdates = 0;
        const syntax: ProfileAwareSyntaxService = {
            get profile() {
                return innerSyntax.profile;
            },
            parse(document) {
                parses++;
                return innerSyntax.parse(document);
            },
            update(previous, document, changes) {
                syntaxUpdates++;
                return innerSyntax.update(previous, document, changes);
            },
            setProfile(profile) {
                innerSyntax.setProfile(profile);
            },
            reprofile(previous) {
                return innerSyntax.reprofile(previous);
            },
        };

        const innerBinder = new CatalogSemanticBinder();
        let binds = 0;
        let bindUpdates = 0;
        const binder: SemanticBinder = {
            bind(input) {
                binds++;
                return innerBinder.bind(input);
            },
            update(previous, input) {
                bindUpdates++;
                return innerBinder.update(previous, input);
            },
        };

        const innerMetadata = new InMemoryMetadataProvider({
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
        let pins = 0;
        const metadata: MetadataProvider = {
            id: "counting",
            pin() {
                pins++;
                return innerMetadata.pin();
            },
            requestHydration: (request) => innerMetadata.requestHydration(request),
            refresh: (signal) => innerMetadata.refresh(signal),
            onDidChange: (listener) => innerMetadata.onDidChange(listener),
        };

        const uri = "file:///shared-snapshot.sql";
        const sql = "DECLARE @value int; SELECT COUNT(Id) FROM dbo.Customers WHERE Id = @value;";
        const runtime = new InProcessLanguageServiceRuntime(syntax, binder, metadata);
        const snapshot = await runtime.open(uri, 1, sql);
        const features = new TsqlLanguageFeatureService(runtime, metadata);
        const variable = sql.lastIndexOf("@value") + 1;
        const table = sql.indexOf("Customers") + 1;

        features.completion(uri, 1, variable);
        features.hover(uri, 1, table);
        features.signatureHelp(uri, 1, sql.indexOf("COUNT(") + 6);
        features.definition(uri, 1, variable);
        features.definitionTarget(uri, 1, table);
        features.references(uri, 1, variable);
        features.prepareRename(uri, 1, variable);
        features.rename(uri, 1, variable, "@replacement");
        features.diagnostics(uri, 1);
        features.documentSymbols(uri, 1);
        features.foldingRanges(uri, 1);
        features.selectionRanges(uri, 1, [table]);
        new TsqlColorizationService().provideDocumentColors(snapshot);

        assert.deepEqual(
            { parses, syntaxUpdates, binds, bindUpdates, pins },
            { parses: 1, syntaxUpdates: 0, binds: 1, bindUpdates: 0, pins: 1 },
        );
    });
});
