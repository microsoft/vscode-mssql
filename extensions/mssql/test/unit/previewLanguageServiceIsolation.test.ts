/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { createProductionLanguageServiceMiddleware } from "../../src/languageservice/preview/productionLanguageServiceIsolation";

chai.use(sinonChai);

suite("Preview language service isolation", () => {
    const document = {
        languageId: "sql",
        uri: vscode.Uri.parse("file:///preview.sql"),
    } as vscode.TextDocument;
    const position = new vscode.Position(0, 0);
    const completionContext: vscode.CompletionContext = {
        triggerKind: vscode.CompletionTriggerKind.Invoke,
        triggerCharacter: undefined,
    };
    let cancellation: vscode.CancellationTokenSource;

    setup(() => {
        cancellation = new vscode.CancellationTokenSource();
    });

    teardown(() => cancellation.dispose());

    test("does not call the production completion provider in preview mode", async () => {
        const next = sinon.stub().resolves([new vscode.CompletionItem("production")]);
        const middleware = createProductionLanguageServiceMiddleware({
            isPreviewEnabled: () => true,
        });

        const result = await middleware.provideCompletionItem?.(
            document,
            position,
            completionContext,
            cancellation.token,
            next,
        );

        expect(result).to.be.undefined;
        expect(next).not.to.have.been.called;
    });

    test("continues routing production features when preview mode is disabled", async () => {
        const completionItems = [new vscode.CompletionItem("production")];
        const next = sinon.stub().resolves(completionItems);
        const onCompletionResult = sinon.stub();
        const middleware = createProductionLanguageServiceMiddleware({
            isPreviewEnabled: () => false,
            onCompletionResult,
        });

        const result = await middleware.provideCompletionItem?.(
            document,
            position,
            completionContext,
            cancellation.token,
            next,
        );

        expect(result).to.equal(completionItems);
        expect(next).to.have.been.calledWith(
            document,
            position,
            completionContext,
            cancellation.token,
        );
        expect(onCompletionResult).to.have.been.calledWith(document, completionContext, 1);
    });

    test("suppresses production hover and push diagnostics in preview mode", async () => {
        const provideHover = sinon.stub().resolves(new vscode.Hover("production"));
        const publishDiagnostics = sinon.stub();
        const middleware = createProductionLanguageServiceMiddleware({
            isPreviewEnabled: () => true,
        });

        const hover = await middleware.provideHover?.(
            document,
            position,
            cancellation.token,
            provideHover,
        );
        middleware.handleDiagnostics?.(
            document.uri,
            [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), "production")],
            publishDiagnostics,
        );

        expect(hover).to.be.undefined;
        expect(provideHover).not.to.have.been.called;
        expect(publishDiagnostics).to.have.been.calledWith(
            document.uri,
            sinon.match((diagnostics: vscode.Diagnostic[]) => diagnostics.length === 0),
        );
    });
});
