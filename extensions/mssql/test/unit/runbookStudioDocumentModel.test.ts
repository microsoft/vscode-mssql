/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
    canonicalizeRunbookArtifact,
    createFixtureRunbookArtifact,
} from "../../src/runbookStudio/runbookArtifact";
import { RunbookStudioDocumentModel } from "../../src/runbookStudio/runbookStudioDocumentModel";

suite("RunbookStudioDocumentModel", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    function createDocument(
        uri: vscode.Uri,
        save: sinon.SinonStub<[], Promise<boolean>>,
    ): vscode.TextDocument {
        const content = canonicalizeRunbookArtifact(createFixtureRunbookArtifact());
        return {
            uri,
            isUntitled: false,
            isDirty: false,
            getText: () => content,
            positionAt: (offset: number) => new vscode.Position(0, offset),
            save,
        } as unknown as vscode.TextDocument;
    }

    test("auto-saves edits to a library virtual document", async () => {
        sandbox.stub(vscode.workspace, "applyEdit").resolves(true);
        const save = sandbox.stub<[], Promise<boolean>>().resolves(true);
        const document = createDocument(
            vscode.Uri.from({ scheme: "mssql-runbook", path: "/rb-1.runbook.json" }),
            save,
        );
        const model = new RunbookStudioDocumentModel(document, sandbox.stub());

        const applied = await model.applyArtifactEdit({
            ...createFixtureRunbookArtifact(),
            name: "Persisted title",
            source: {
                ...createFixtureRunbookArtifact().source,
                intent: "Persisted prompt",
            },
        });

        expect(applied).to.equal(true);
        expect(save).to.have.been.calledOnceWithExactly();
        model.dispose();
    });

    test("reports a failed library commit as an unsuccessful edit", async () => {
        sandbox.stub(vscode.workspace, "applyEdit").resolves(true);
        const save = sandbox.stub<[], Promise<boolean>>().resolves(false);
        const document = createDocument(
            vscode.Uri.from({ scheme: "mssql-runbook", path: "/rb-1.runbook.json" }),
            save,
        );
        const model = new RunbookStudioDocumentModel(document, sandbox.stub());

        const applied = await model.applyArtifactEdit(createFixtureRunbookArtifact());

        expect(applied).to.equal(false);
        expect(save).to.have.been.calledOnceWithExactly();
        model.dispose();
    });

    test("keeps normal dirty-buffer semantics for exported files", async () => {
        sandbox.stub(vscode.workspace, "applyEdit").resolves(true);
        const save = sandbox.stub<[], Promise<boolean>>().resolves(true);
        const document = createDocument(vscode.Uri.file("C:\\repo\\checked-in.runbook.json"), save);
        const model = new RunbookStudioDocumentModel(document, sandbox.stub());

        const applied = await model.applyArtifactEdit(createFixtureRunbookArtifact());

        expect(applied).to.equal(true);
        expect(save).to.not.have.been.called;
        model.dispose();
    });
});
