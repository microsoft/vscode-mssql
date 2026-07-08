/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { diag, DiagnosticSink } from "../../src/diagnostics/diagnosticsCore";
import { DiagEvent } from "../../src/sharedInterfaces/debugConsole";
import { NativeSqlLanguageEngine } from "../../src/sqlLanguage/host/nativeEngine";
import { FixtureLanguageMetadataProvider } from "../../src/sqlLanguage/provider/fixtureProvider";
import { STANDARD_FIXTURE_CATALOG } from "../../src/sqlLanguage/testSupport/fixtureCatalog";
import { parseFourslash } from "../../src/sqlLanguage/testSupport/fourslash";
import { TextSnapshot } from "../../src/sqlLanguage/core/text/textSnapshot";

function eventValue(event: DiagEvent | undefined, key: string): unknown {
    return event?.payload?.[key]?.v;
}

function captureEvents(): { readonly events: DiagEvent[]; readonly sink: DiagnosticSink } {
    const events: DiagEvent[] = [];
    const sink: DiagnosticSink = {
        id: `sqlLanguageJournalTestSink_${Date.now()}_${Math.random()}`,
        tryWrite: (event) => void events.push(event),
    };
    diag.addSink(sink);
    return { events, sink };
}

suite("sqlLanguage journal diagnostics", () => {
    test("rich completion spans include parser expectation and candidate-kind details", async () => {
        const wasRich = diag.richMode;
        const { events, sink } = captureEvents();
        diag.setRichMode(true, "unit-test");
        try {
            const source = "SELECT * FROM Sales.Orders o WHERE /*caret*/";
            const fixture = parseFourslash(source);
            const snapshot = new TextSnapshot(fixture.text, 1);
            const engine = new NativeSqlLanguageEngine(
                new FixtureLanguageMetadataProvider(STANDARD_FIXTURE_CATALOG),
            );

            await engine.completion({
                text: fixture.text,
                version: 1,
                position: snapshot.positionAt(fixture.caret!),
                trigger: "invoke",
            });

            const completionEnd = events.find((e) => e.type === "sqlLanguage.completion.end");
            expect(eventValue(completionEnd, "expectationKind")).to.equal("predicateExpression");
            expect(eventValue(completionEnd, "statementKind")).to.equal("select");
            expect(eventValue(completionEnd, "contextClause")).to.equal("where");
            expect(String(eventValue(completionEnd, "completionItemKinds"))).to.contain("column:");

            const parseEnd = events.find((e) => e.type === "sqlLanguage.parse.end");
            expect(eventValue(parseEnd, "statementKinds")).to.equal("select:1");
            expect(String(eventValue(parseEnd, "clauseKinds"))).to.contain("where:1");
        } finally {
            diag.removeSink(sink.id);
            diag.setRichMode(wasRich, "unit-test-restore");
        }
    });

    test("normal completion spans keep rich parser counters out of the journal", async () => {
        const wasRich = diag.richMode;
        const { events, sink } = captureEvents();
        diag.setRichMode(false, "unit-test");
        try {
            const source = "SELECT * FROM Sales.Orders o WHERE /*caret*/";
            const fixture = parseFourslash(source);
            const snapshot = new TextSnapshot(fixture.text, 1);
            const engine = new NativeSqlLanguageEngine(
                new FixtureLanguageMetadataProvider(STANDARD_FIXTURE_CATALOG),
            );

            await engine.completion({
                text: fixture.text,
                version: 1,
                position: snapshot.positionAt(fixture.caret!),
                trigger: "invoke",
            });

            const completionEnd = events.find((e) => e.type === "sqlLanguage.completion.end");
            expect(eventValue(completionEnd, "expectationKind")).to.equal("predicateExpression");
            expect(eventValue(completionEnd, "statementKind")).to.equal(undefined);
            expect(eventValue(completionEnd, "completionItemKinds")).to.equal(undefined);
        } finally {
            diag.removeSink(sink.id);
            diag.setRichMode(wasRich, "unit-test-restore");
        }
    });

    test("rich diagnostics spans include syntax recovery and code counts", async () => {
        const wasRich = diag.richMode;
        const { events, sink } = captureEvents();
        diag.setRichMode(true, "unit-test");
        try {
            const engine = new NativeSqlLanguageEngine(
                new FixtureLanguageMetadataProvider(STANDARD_FIXTURE_CATALOG),
            );

            await engine.diagnostics({
                text: "select * fr om Sales.Orders",
                version: 1,
            });

            const diagnosticsEnd = events.find((e) => e.type === "sqlLanguage.diagnostics.end");
            expect(eventValue(diagnosticsEnd, "diagnosticCodes")).to.equal("mssql(102):1");
            expect(eventValue(diagnosticsEnd, "syntaxUntrustedCount")).to.equal(1);
            expect(String(eventValue(diagnosticsEnd, "suppressionReasons"))).to.contain(
                "syntaxUntrusted:1",
            );
        } finally {
            diag.removeSink(sink.id);
            diag.setRichMode(wasRich, "unit-test-restore");
        }
    });
});
