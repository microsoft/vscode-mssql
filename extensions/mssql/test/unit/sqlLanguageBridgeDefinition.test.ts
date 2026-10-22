/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { SqlLanguageRequest } from "../../src/sqlLanguage/api";
import { Sts2BridgeEngine } from "../../src/sqlLanguage/host/bridgeEngine";

suite("sqlLanguage bridge definition delivery", () => {
    let sandbox: sinon.SinonSandbox;
    let command: sinon.SinonStub;
    let openDocument: sinon.SinonStub;
    let showDocument: sinon.SinonStub;
    let engine: Sts2BridgeEngine;
    const sourceUri = vscode.Uri.parse("untitled:query.sql");
    const targetUri = vscode.Uri.parse("file:///project/dbo.Table.sql");
    const targetRange = new vscode.Range(2, 3, 2, 8);
    const script = "-- generated definition\n\nCREATE TABLE dbo.Table (id int);";
    const request: SqlLanguageRequest = {
        text: "SELECT * FROM dbo.Table;",
        version: 1,
        position: { line: 0, character: 20 },
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        command = sandbox.stub(vscode.commands, "executeCommand");
        openDocument = sandbox.stub(vscode.workspace, "openTextDocument").resolves({
            uri: targetUri,
            version: 7,
            getText: () => script,
        } as vscode.TextDocument);
        showDocument = sandbox.stub(vscode.window, "showTextDocument");
        engine = new Sts2BridgeEngine({
            backingDocument: () => ({ uri: sourceUri }) as vscode.TextDocument,
            ensureShadowConnection: async () => true,
        });
    });
    teardown(() => sandbox.restore());

    for (const location of [
        new vscode.Location(targetUri, targetRange),
        { targetUri, targetRange },
    ]) {
        test(`returns peek content without opening an editor for ${"targetUri" in location ? "LocationLink" : "Location"}`, async () => {
            command.resolves([location]);

            const result = await engine.definition(request);

            expect(result?.virtualContent).to.include({ title: "dbo.Table", text: script });
            expect(result?.virtualContent?.anchor).to.deep.equal({ line: 2, character: 3 });
            expect(result).to.have.deep.property("externalTarget", {
                uri: targetUri.toString(),
                range: {
                    start: { line: 2, character: 3 },
                    end: { line: 2, character: 8 },
                },
            });
            expect(showDocument.called).to.equal(false);
        });
    }

    test("local definitions stay in the source document", async () => {
        command.resolves([new vscode.Location(sourceUri, targetRange)]);

        expect(await engine.definition(request)).to.deep.equal({
            range: {
                start: { line: 2, character: 3 },
                end: { line: 2, character: 8 },
            },
        });
        expect(openDocument.called).to.equal(false);
        expect(showDocument.called).to.equal(false);
    });

    test("unreadable targets return no definition without opening an editor", async () => {
        command.resolves([new vscode.Location(targetUri, targetRange)]);
        openDocument.rejects(new Error("Definition unavailable"));

        expect(await engine.definition(request)).to.equal(undefined);
        expect(showDocument.called).to.equal(false);
    });
});
