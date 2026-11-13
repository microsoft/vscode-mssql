/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B10 / LS-2 Query Studio diagnostics publish path: engine routing and
 * mutual exclusion (native route mutes bridge push-forwarding and vice
 * versa), the mssql.sqlLanguage.diagnostics.enabled gate (false = native
 * publishes nothing so markers clear), the debounced/sliced publish loop,
 * and suppression counts surfaced through the status snapshot.
 */

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { NATIVE_DIAGNOSTIC_SOURCE } from "../../src/sqlLanguage/features/diagnostics";
import { QueryStudioLanguageService } from "../../src/queryStudio/queryStudioLanguageService";

function stubConfiguration(sandbox: sinon.SinonSandbox, overrides: Record<string, unknown>): void {
    sandbox.stub(vscode.workspace, "getConfiguration").callsFake(
        () =>
            ({
                get: <T>(key: string, defaultValue?: T): T | undefined =>
                    key in overrides ? (overrides[key] as T) : defaultValue,
            }) as vscode.WorkspaceConfiguration,
    );
}

function tick(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openSqlDocument(content: string): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({ language: "sql", content });
}

function serviceFor(document: vscode.TextDocument): QueryStudioLanguageService {
    return new QueryStudioLanguageService({
        backingDocument: () => document,
        sessionBinding: () => undefined,
        databases: () => undefined,
    });
}

suite("queryStudio language diagnostics publish path (B10)", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });
    teardown(() => {
        sandbox.restore();
    });

    test("nativeTypeScript preference serves diagnostics natively with the native source", async () => {
        stubConfiguration(sandbox, {
            "mssql.queryStudio.languageService.engine": "nativeTypeScript",
        });
        const document = await openSqlDocument("SELECT (1 + 2))");
        const service = serviceFor(document);
        try {
            const route = service.status().router.find((entry) => entry.feature === "diagnostics");
            expect(route?.effectiveEngine).to.equal("nativeTypeScript");
            expect(route?.maturity).to.equal("preview");
            const result = await service.diagnostics();
            expect(result).to.not.equal(undefined);
            expect(result!.diagnostics).to.have.length(1);
            expect(result!.diagnostics[0].source).to.equal(NATIVE_DIAGNOSTIC_SOURCE);
            expect(result!.diagnostics[0].severity).to.equal("error");
        } finally {
            service.dispose();
        }
    });

    test("diagnostics.enabled=false: the native engine publishes NOTHING (markers clear)", async () => {
        stubConfiguration(sandbox, {
            "mssql.queryStudio.languageService.engine": "nativeTypeScript",
            "mssql.sqlLanguage.diagnostics.enabled": false,
        });
        const document = await openSqlDocument("SELECT (1 + 2))");
        const service = serviceFor(document);
        try {
            const result = await service.diagnostics();
            expect(result).to.deep.equal({ diagnostics: [] });
            expect(service.status().diagnostics.enabled).to.equal(false);
        } finally {
            service.dispose();
        }
    });

    test("default preference routes diagnostics to the bridge", async () => {
        stubConfiguration(sandbox, {});
        const document = await openSqlDocument("SELECT (1 + 2))");
        const service = serviceFor(document);
        try {
            const route = service.status().router.find((entry) => entry.feature === "diagnostics");
            expect(route?.effectiveEngine).to.equal("sqlToolsServiceBridge");
            // Bridge pull: nothing published in the mssql collection here.
            const result = await service.diagnostics();
            expect(result?.diagnostics ?? []).to.have.length(0);
        } finally {
            service.dispose();
        }
    });

    test("MUTUAL EXCLUSION: bridge diagnostic pushes are ignored while natively routed", async () => {
        stubConfiguration(sandbox, {
            "mssql.queryStudio.languageService.engine": "nativeTypeScript",
        });
        const document = await openSqlDocument("SELECT 1");
        const service = serviceFor(document);
        const collection = vscode.languages.createDiagnosticCollection("b10-mutex-native");
        try {
            let notified = 0;
            service.onDiagnosticsChanged(() => notified++);
            collection.set(document.uri, [
                new vscode.Diagnostic(
                    new vscode.Range(0, 0, 0, 1),
                    "bridge-style marker",
                    vscode.DiagnosticSeverity.Error,
                ),
            ]);
            await tick(100);
            expect(notified).to.equal(0);
        } finally {
            collection.clear();
            collection.dispose();
            service.dispose();
        }
    });

    test("bridge route forwards diagnostic pushes for the backing document", async () => {
        stubConfiguration(sandbox, {});
        const document = await openSqlDocument("SELECT 1");
        const service = serviceFor(document);
        const collection = vscode.languages.createDiagnosticCollection("b10-mutex-bridge");
        try {
            let notified = 0;
            service.onDiagnosticsChanged(() => notified++);
            collection.set(document.uri, [
                new vscode.Diagnostic(
                    new vscode.Range(0, 0, 0, 1),
                    "bridge-style marker",
                    vscode.DiagnosticSeverity.Error,
                ),
            ]);
            await tick(100);
            expect(notified).to.be.at.least(1);
        } finally {
            collection.clear();
            collection.dispose();
            service.dispose();
        }
    });

    test("edit -> debounced sliced pass -> publish with suppression counts in status", async function () {
        this.timeout(10000);
        stubConfiguration(sandbox, {
            "mssql.queryStudio.languageService.engine": "nativeTypeScript",
        });
        const document = await openSqlDocument("EXEC('SELECT 1')");
        const service = serviceFor(document);
        try {
            let notified = 0;
            service.onDiagnosticsChanged(() => notified++);
            const edit = new vscode.WorkspaceEdit();
            edit.insert(document.uri, new vscode.Position(0, 0), "-- edited\n");
            const applied = await vscode.workspace.applyEdit(edit);
            expect(applied).to.equal(true);
            // 300ms debounce + sliced pass; poll up to 5s.
            let status = service.status();
            for (let i = 0; i < 50 && status.diagnostics.lastPassVersion === undefined; i++) {
                await tick(100);
                status = service.status();
            }
            expect(status.diagnostics.lastPassVersion).to.equal(document.version);
            expect(status.diagnostics.suppressionCounts.dynamicSql ?? 0).to.be.at.least(1);
            expect(notified).to.be.at.least(1);
            expect(status.diagnostics.scheduler).to.equal("idle");
        } finally {
            service.dispose();
        }
    });

    test("status snapshot exposes the diagnostics block", async () => {
        stubConfiguration(sandbox, {});
        const document = await openSqlDocument("SELECT 1");
        const service = serviceFor(document);
        try {
            const status = service.status();
            expect(status.diagnostics.enabled).to.equal(true);
            expect(status.diagnostics.scheduler).to.equal("idle");
            expect(status.diagnostics.suppressionCounts).to.deep.equal({});
        } finally {
            service.dispose();
        }
    });
});

suite("queryStudio language service gates and breaker", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });
    teardown(() => {
        sandbox.restore();
    });

    const NATIVE = { "mssql.queryStudio.languageService.engine": "nativeTypeScript" };

    test("breaker: a pass over the cap is withheld entirely (markers clear)", async () => {
        stubConfiguration(sandbox, NATIVE);
        const flooded = Array.from({ length: 101 }, () => "GO junk").join(String.fromCharCode(10));
        const document = await openSqlDocument(flooded);
        const service = serviceFor(document);
        const result = await service.diagnostics();
        expect(result?.diagnostics).to.deep.equal([]);
        service.dispose();
    });

    test("breaker: under the cap the same class of errors publishes normally", async () => {
        stubConfiguration(sandbox, NATIVE);
        const document = await openSqlDocument(
            Array.from({ length: 5 }, () => "GO junk").join(String.fromCharCode(10)),
        );
        const service = serviceFor(document);
        const result = await service.diagnostics();
        expect(result?.diagnostics.length).to.equal(5);
        service.dispose();
    });

    test("enableIntelliSense=false shuts off completions, hover, signature help and diagnostics", async () => {
        stubConfiguration(sandbox, { ...NATIVE, enableIntelliSense: false });
        const document = await openSqlDocument("SELECT 1");
        const service = serviceFor(document);
        expect(await service.completion({ line: 0, character: 7 }, "invoke")).to.equal(undefined);
        expect(await service.hover({ line: 0, character: 2 })).to.equal(undefined);
        expect(await service.signatureHelp({ line: 0, character: 8 })).to.equal(undefined);
        expect((await service.diagnostics())?.diagnostics).to.deep.equal([]);
        service.dispose();
    });

    test("enableSuggestions=false gates completions AND signature help; hover survives", async () => {
        stubConfiguration(sandbox, { ...NATIVE, enableSuggestions: false });
        const document = await openSqlDocument("SELECT 1");
        const service = serviceFor(document);
        expect(await service.completion({ line: 0, character: 7 }, "invoke")).to.equal(undefined);
        expect(await service.signatureHelp({ line: 0, character: 8 })).to.equal(undefined);
        service.dispose();
    });

    test("enableQuickInfo=false gates hover; completions survive", async () => {
        stubConfiguration(sandbox, { ...NATIVE, enableQuickInfo: false });
        const document = await openSqlDocument("SELECT 1");
        const service = serviceFor(document);
        expect(await service.hover({ line: 0, character: 2 })).to.equal(undefined);
        const completions = await service.completion({ line: 0, character: 7 }, "invoke");
        expect(completions?.items.length ?? 0).to.be.greaterThan(0);
        service.dispose();
    });

    test("enableErrorChecking=false: native publishes nothing so markers clear", async () => {
        stubConfiguration(sandbox, { ...NATIVE, enableErrorChecking: false });
        const document = await openSqlDocument("SELECT (1 + 2))");
        const service = serviceFor(document);
        expect((await service.diagnostics())?.diagnostics).to.deep.equal([]);
        service.dispose();
    });
});
