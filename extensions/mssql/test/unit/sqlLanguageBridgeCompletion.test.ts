/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { CompletionRequest } from "../../src/sqlLanguage/api";
import { Sts2BridgeEngine } from "../../src/sqlLanguage/host/bridgeEngine";
import { TextSnapshot } from "../../src/sqlLanguage/core/text/textSnapshot";
import { parseFourslash } from "../../src/sqlLanguage/testSupport/fourslash";

function request(marked: string): CompletionRequest {
    const fixture = parseFourslash(marked);
    return {
        text: fixture.text,
        version: 1,
        position: new TextSnapshot(fixture.text).positionAt(fixture.caret!),
        trigger: "invoke",
    };
}

suite("sqlLanguage bridge completion suppression", () => {
    const sandbox = sinon.createSandbox();
    let command: sinon.SinonStub;
    let engine: Sts2BridgeEngine;

    setup(() => {
        command = sandbox
            .stub(vscode.commands, "executeCommand")
            .resolves(
                new vscode.CompletionList([
                    new vscode.CompletionItem("SELECT", vscode.CompletionItemKind.Keyword),
                ]),
            );
        engine = new Sts2BridgeEngine({
            backingDocument: () =>
                ({ uri: vscode.Uri.parse("untitled:bridge.sql") }) as vscode.TextDocument,
            ensureShadowConnection: async () => false,
        });
    });
    teardown(() => sandbox.restore());

    for (const text of [
        "-- which customers bought products? /*caret*/",
        "SELECT 1 -- /*caret*/comment\nSELECT 2",
        "/* outer\n /* nested */ /*caret*/ still outer */",
        "/* open /*caret*/",
        "SELECT '/*caret*/",
        "SELECT N'quoted '' text /*caret*/more'",
        ":setvar name /*caret*/value",
    ]) {
        test(`does not aggregate providers inside ${JSON.stringify(text)}`, async () => {
            expect(await engine.completion(request(text))).to.deep.equal({
                items: [],
                isIncomplete: false,
            });
            expect(command.called).to.equal(false);
        });
    }

    for (const text of [
        "/*caret*/",
        "SEL/*caret*/",
        "-- comment\n/*caret*/",
        "/* closed *//*caret*/",
        "SELECT 'closed'/*caret*/",
        "SELECT [--identifier/*caret*/]",
        'SELECT "/*identifier/*caret*/"',
    ]) {
        test(`keeps SQL completion available at ${JSON.stringify(text)}`, async () => {
            const result = await engine.completion(request(text));
            expect(result?.items.map((item) => item.label)).to.deep.equal(["SELECT"]);
            expect(command.calledWith("vscode.executeCompletionItemProvider")).to.equal(true);
        });
    }

    test("request text takes precedence over a reused document version", async () => {
        expect((await engine.completion(request("SELECT /*caret*/")))?.items).not.to.be.empty;
        command.resetHistory();
        expect((await engine.completion(request("SELECT -- /*caret*/")))?.items).to.be.empty;
        expect(command.called).to.equal(false);
    });
});
