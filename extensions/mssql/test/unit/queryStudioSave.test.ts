/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { QueryStudioDocumentModel } from "../../src/queryStudio/queryStudioDocumentModel";
import {
    QueryStudioEditorProvider,
    QUERY_STUDIO_VIEW_TYPE,
} from "../../src/queryStudio/queryStudioEditorProvider";

suite("Query Studio Save As boundary", () => {
    const sandbox = sinon.createSandbox();
    teardown(() => sandbox.restore());

    function fixture(untitled = true) {
        const uri = vscode.Uri.parse(untitled ? "untitled:Untitled-1" : "file:///source.mssql");
        const getText = sandbox.stub().returns("SELECT 1;");
        const document = { uri, isUntitled: untitled, getText } as unknown as vscode.TextDocument;
        const model = sandbox.createStubInstance(QueryStudioDocumentModel);
        sandbox.stub(model, "backingDocument").get(() => document);
        sandbox.stub(model, "uriKey").get(() => uri.toString());
        model.panelCount = 1;
        const provider = new QueryStudioEditorProvider({
            subscriptions: [],
        } as unknown as vscode.ExtensionContext);
        provider["models"].set(uri.toString(), model);
        const execute = sandbox.stub(vscode.commands, "executeCommand").resolves();
        return { uri, getText, model, provider, execute };
    }

    test("uses the exact Save As target without matching another document by SQL text", async () => {
        const { uri, getText, model, provider, execute } = fixture();
        const target = vscode.Uri.parse("file:///chosen.mssql");
        const save = sandbox.stub(vscode.workspace, "saveAs").callsFake(async () => {
            expect(model.panelCount).to.equal(2);
            return target;
        });
        await provider["saveDocument"](model, false);
        sinon.assert.calledWith(save, uri);
        sinon.assert.calledWith(execute, "vscode.openWith", target, QUERY_STUDIO_VIEW_TYPE);
        sinon.assert.notCalled(getText);
        sinon.assert.notCalled(model.dispose);
        expect(model.panelCount).to.equal(1);
    });

    test("cancellation and an explicitly chosen .sql target never open Query Studio", async () => {
        const { model, provider, execute } = fixture();
        const save = sandbox.stub(vscode.workspace, "saveAs");
        save.onFirstCall().resolves(undefined);
        save.onSecondCall().resolves(vscode.Uri.parse("file:///classic.sql"));
        await provider["saveDocument"](model, true);
        await provider["saveDocument"](model, true);
        sinon.assert.notCalled(execute);
        sinon.assert.notCalled(model.dispose);
        expect(model.panelCount).to.equal(1);
    });

    test("normal Save keeps the existing .mssql document without opening Save As", async () => {
        const { uri, model, provider, execute } = fixture(false);
        const save = sandbox.stub(vscode.workspace, "save").resolves(uri);
        const saveAs = sandbox.stub(vscode.workspace, "saveAs");
        await provider["saveDocument"](model, false);
        sinon.assert.calledWith(save, uri);
        sinon.assert.notCalled(saveAs);
        sinon.assert.notCalled(execute);
    });
});
