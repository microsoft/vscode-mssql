/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";
import * as vscode from "vscode";
import * as Constants from "../../src/constants/constants";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { SqlCmdLanguageFlavorTracker } from "../../src/languageservice/sqlCmdLanguageFlavorTracker";
import { LanguageFlavorChangedNotification } from "../../src/models/contracts/languageService";

chai.use(sinonChai);

suite("SqlCmdLanguageFlavorTracker", () => {
    const checkDelayMs = 400;
    const docUri = "file:///test/query.sql";
    let sandbox: sinon.SinonSandbox;
    let clock: sinon.SinonFakeTimers;
    let sendNotification: sinon.SinonStub;
    let tracker: SqlCmdLanguageFlavorTracker;
    let text: string;
    let document: vscode.TextDocument;

    setup(() => {
        sandbox = sinon.createSandbox();
        clock = sandbox.useFakeTimers();
        sendNotification = sandbox.stub();
        sandbox.stub(SqlToolsServiceClient, "instance").value({ sendNotification });
        tracker = new SqlCmdLanguageFlavorTracker(checkDelayMs);
        text = "SELECT 1";
        document = {
            uri: vscode.Uri.parse(docUri),
            isClosed: false,
            getText: () => text,
        } as vscode.TextDocument;
    });

    teardown(() => {
        tracker.dispose();
        sandbox.restore();
    });

    function expectLanguage(language: string): void {
        expect(sendNotification).to.have.been.calledWith(
            LanguageFlavorChangedNotification.type,
            sinon.match({ uri: docUri, language }),
        );
    }

    function edit(newText: string): void {
        text = newText;
        tracker.onDidChangeTextDocument(document);
    }

    test("Auto keeps the T-SQL flavor for a document without SQLCMD syntax", () => {
        tracker.update(document, Constants.SqlCmdMode.Auto);

        expect(sendNotification).to.not.have.been.called;
    });

    test("Auto uses the SQLCMD flavor for a document with SQLCMD syntax", () => {
        text = ":setvar x 1\nSELECT $(x)";

        tracker.update(document, Constants.SqlCmdMode.Auto);

        expectLanguage("sqlcmd");
    });

    test("Auto switches to the SQLCMD flavor after an edit adds SQLCMD syntax, and back after it's removed", () => {
        tracker.update(document, Constants.SqlCmdMode.Auto);

        edit(":setvar x 1\nSELECT 1");
        clock.tick(checkDelayMs - 1);
        expect(sendNotification).to.not.have.been.called;
        clock.tick(1);
        expectLanguage("sqlcmd");

        sendNotification.resetHistory();
        edit("SELECT 1");
        clock.tick(checkDelayMs);
        expectLanguage(Constants.languageId);
    });

    test("Auto checks only the latest text after rapid edits", () => {
        tracker.update(document, Constants.SqlCmdMode.Auto);

        edit(":setvar x 1");
        clock.tick(checkDelayMs / 2);
        edit("SELECT 1");
        clock.tick(checkDelayMs);

        expect(sendNotification).to.not.have.been.called;
    });

    test("Auto doesn't notify again when an edit keeps SQLCMD syntax", () => {
        text = ":setvar x 1";
        tracker.update(document, Constants.SqlCmdMode.Auto);
        sendNotification.resetHistory();

        edit(":setvar x 1\nSELECT $(x)");
        clock.tick(checkDelayMs);

        expect(sendNotification).to.not.have.been.called;
    });

    const plainEdits: [string, string][] = [
        ["a mid-line colon", "SELECT 1 :setvar x 1"],
        ["a command in a string", "SELECT '\n:setvar x 1\n'"],
        ["a command in a comment", "/*\n:setvar x 1\n*/\n-- :r file.sql"],
        ["a variable in a string", "SELECT '$(var)'"],
    ];

    for (const [name, plainText] of plainEdits) {
        test(`Auto keeps the T-SQL flavor after an edit adds ${name}`, () => {
            tracker.update(document, Constants.SqlCmdMode.Auto);

            edit(plainText);
            clock.tick(checkDelayMs);

            expect(sendNotification).to.not.have.been.called;
        });
    }

    test("On uses the SQLCMD flavor and switching to Auto re-checks the document", () => {
        tracker.update(document, Constants.SqlCmdMode.On);
        expectLanguage("sqlcmd");

        sendNotification.resetHistory();
        tracker.update(document, Constants.SqlCmdMode.Auto);

        expectLanguage(Constants.languageId);
    });

    test("Off ignores edits that add SQLCMD syntax", () => {
        tracker.update(document, Constants.SqlCmdMode.Off);

        edit(":setvar x 1");
        clock.tick(checkDelayMs);

        expect(sendNotification).to.not.have.been.called;
    });

    test("closing a document cancels its pending check", () => {
        tracker.update(document, Constants.SqlCmdMode.Auto);

        edit(":setvar x 1");
        tracker.onDidCloseTextDocument(document);
        clock.tick(checkDelayMs);

        expect(sendNotification).to.not.have.been.called;
    });
});
