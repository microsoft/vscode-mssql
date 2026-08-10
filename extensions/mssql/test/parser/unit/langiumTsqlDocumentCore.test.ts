/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as vscode from "vscode";
import {
    MappingCatalogProvider,
    SaralSqlAnalysisEngine,
    type SqlAnalysisSnapshot,
} from "@vscode-mssql/tsql-language-service";
import {
    createTsqlLangiumServices,
    DocumentState,
    StaleTsqlDocumentError,
    TsqlOperationCancelledError,
    TsqlTextDocumentSnapshot,
    URI,
    type TsqlDocumentSource,
} from "../../../src/languageservice/langium";

suite("Langium T-SQL document core", () => {
    test("composes provider services through Langium dependency injection", () => {
        interface FeatureServices {
            readonly feature: { documentCount(): number };
        }

        const services = createTsqlLangiumServices<FeatureServices>(
            { engine: new SaralSqlAnalysisEngine() },
            {
                feature: (injected) => ({
                    documentCount: () => injected.documents.all.length,
                }),
            },
        );
        services.documents.update(source("SELECT 1", 1));

        expect(services.feature.documentCount()).to.equal(1);
    });

    test("creates Langium snapshots and advances the package parser incrementally", () => {
        const services = createServices();
        const first = services.documents.update(source("SELECT 1", 1));
        const second = services.documents.update(source("SELECT 2", 2));

        expect(first.parseResult.value.$document).to.equal(first);
        expect(first.state).to.equal(DocumentState.Changed);
        expect(second.state).to.equal(DocumentState.Parsed);
        expect(sessionOf(second).text).to.equal("SELECT 2");
        expect(sessionOf(second).version).to.equal(sessionOf(first).version + 1);
        expect(second.generation).to.be.greaterThan(first.generation);
    });

    test("does not replace a current snapshot with a late editor event", () => {
        const services = createServices();
        const current = services.documents.update(source("SELECT 2", 2));
        const result = services.documents.update(source("SELECT 1", 1));

        expect(result).to.equal(current);
        expect(services.documents.get(current.uri)).to.equal(current);
        expect(sessionOf(current).text).to.equal("SELECT 2");
    });

    test("refreshes analysis when the schema revision changes", () => {
        const schema = new MappingCatalogProvider({ dbo: { users: { id: "int" } } });
        const services = createServices();
        const first = services.documents.update(source("SELECT id FROM dbo.users", 1), {
            catalog: { provider: schema, revision: 1 },
        });
        const unchanged = services.documents.update(source("SELECT id FROM dbo.users", 1), {
            catalog: { provider: schema, revision: 1 },
        });
        const refreshed = services.documents.update(source("SELECT id FROM dbo.users", 1), {
            catalog: { provider: schema, revision: 2 },
        });

        expect(unchanged).to.equal(first);
        expect(refreshed).to.not.equal(first);
        expect(sessionOf(refreshed).version).to.equal(sessionOf(first).version + 1);
        expect(refreshed.catalog.revision).to.equal(2);
    });

    test("keeps editor offsets separate from parser recovery text", () => {
        const services = createServices();
        const editorText = "SELECT 'unfinished";
        const parseText = `${editorText}'`;
        const document = services.documents.update(source(editorText, 1), { parseText });

        expect(document.textDocument.getText()).to.equal(editorText);
        expect(document.parseResult.value.length).to.equal(editorText.length);
        expect(document.analysis.text).to.equal(parseText);
    });

    test("adopts a prebuilt analysis snapshot without reparsing", () => {
        const engine = new SaralSqlAnalysisEngine();
        const services = createTsqlLangiumServices({ engine });
        const analysis = engine.createSnapshot({
            text: "SELECT 1",
            uri: "file:///langium-core.sql",
        });

        const document = services.documents.update(source(analysis.text, 1), { analysis });

        expect(document.analysis).to.equal(analysis);
    });

    test("deduplicates work and rejects results from superseded snapshots", async () => {
        const services = createServices();
        const document = services.documents.update(source("SELECT 1", 1));
        let runs = 0;
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const work = services.documents.compute(document, "diagnostics", async (context) => {
            runs++;
            await gate;
            context.throwIfCancelled();
            return [
                ...sessionOf(document).syntaxDiagnostics,
                ...sessionOf(document).semanticDiagnostics,
            ];
        });
        const duplicate = services.documents.compute(document, "diagnostics", async () => {
            throw new Error("duplicate computation must not run");
        });

        await Promise.resolve();
        expect(runs).to.equal(1);
        expect(duplicate).to.equal(work);
        services.documents.update(source("SELECT 2", 2));
        release?.();

        const results = await Promise.allSettled([work, duplicate]);
        expect(results).to.have.length(2);
        for (const result of results) {
            expect(result.status).to.equal("rejected");
            if (result.status === "rejected") {
                expect(result.reason).to.be.instanceOf(StaleTsqlDocumentError);
            }
        }
    });

    test("observes VS Code cancellation without deleting reusable completed work", async () => {
        const services = createServices();
        const document = services.documents.update(source("SELECT 1", 1));
        const cancellation = new vscode.CancellationTokenSource();
        cancellation.cancel();

        let error: unknown;
        try {
            await services.documents.compute(document, "symbols", () => [], cancellation.token);
        } catch (caught) {
            error = caught;
        } finally {
            cancellation.dispose();
        }

        expect(error).to.be.instanceOf(TsqlOperationCancelledError);
        expect(
            await services.documents.compute(document, "symbols", () => ["select"]),
        ).to.deep.equal(["select"]);
    });

    test("provides the complete Langium text document line contract", () => {
        const document = new TsqlTextDocumentSnapshot(
            "file:///lines.sql",
            "sql",
            1,
            "one\r\ntwo\nthree",
        );

        expect(document.lineCount).to.equal(3);
        expect(document.getEOLCharacters(0)).to.equal("\r\n");
        expect(document.getEOLCharacters(1)).to.equal("\n");
        expect(document.getLineRange(1)).to.deep.equal({
            start: { line: 1, character: 0 },
            end: { line: 1, character: 3 },
        });
        expect(document.positionAt(5)).to.deep.equal({ line: 1, character: 0 });
        expect(document.offsetAt({ line: 1, character: 100 })).to.equal(8);
    });
});

function source(text: string, version: number): TsqlDocumentSource {
    return {
        uri: URI.parse("file:///langium-core.sql"),
        languageId: "sql",
        version,
        getText: () => text,
    };
}

function createServices() {
    return createTsqlLangiumServices({ engine: new SaralSqlAnalysisEngine() });
}

function sessionOf(document: { readonly analysis: SqlAnalysisSnapshot }) {
    return document.analysis;
}
