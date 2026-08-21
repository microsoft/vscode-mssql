/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { PreviewCompletionProvider } from "../../src/languageservice/preview/previewVscodeFeatureProviders";
import type { PreviewDocumentState } from "../../src/languageservice/preview/previewLanguageServiceState";

suite("Preview completion metadata hydration", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("waits for the new pinned generation before retrying completion", async () => {
        let rebound = false;
        let calls = 0;
        const uri = vscode.Uri.parse("file:///hydration.sql");
        const state = {
            connectionUri: uri.toString(),
            syncedVersion: 1,
            disposed: false,
            queue: Promise.resolve(),
            features: {
                completion() {
                    calls++;
                    return rebound
                        ? {
                              incomplete: false,
                              items: [{ label: "Person", kind: "schema" }],
                          }
                        : { incomplete: true, items: [] };
                },
            },
            metadata: {
                waitForHydration() {
                    // Metadata publication schedules the host-owned rebind asynchronously. The
                    // hydration promise itself may settle before that queue entry has run.
                    state.queue = new Promise<void>((resolve) => {
                        setTimeout(() => {
                            rebound = true;
                            resolve();
                        }, 0);
                    });
                    return Promise.resolve();
                },
            },
        } as unknown as PreviewDocumentState;
        const provider = new PreviewCompletionProvider(
            () => true,
            () => state,
            {
                interactiveLatencyBudgetMs: 50,
                emptyCompletionLatencyBudgetMs: 50,
            } as never,
        );
        const document = {
            uri,
            version: 1,
            offsetAt: () => 0,
            positionAt: () => new vscode.Position(0, 0),
        } as unknown as vscode.TextDocument;
        const cancellation = new vscode.CancellationTokenSource();
        try {
            const result = await provider.provideCompletionItems(
                document,
                new vscode.Position(0, 0),
                cancellation.token,
            );
            expect(calls).to.equal(2);
            expect(result?.items.map((item) => item.label)).to.deep.equal(["Person"]);
        } finally {
            cancellation.dispose();
        }
    });

    test("resolves the selected service completion item", async () => {
        const uri = vscode.Uri.parse("file:///completion-resolve.sql");
        let resolvedLabel: string | undefined;
        const completion = sandbox.stub().returns({
            incomplete: false,
            items: [
                {
                    label: "RunReport",
                    kind: "procedure",
                    edit: { start: 5, end: 8, newText: "dbo.RunReport" },
                    data: { kind: "procedureParameterHydration" },
                },
            ],
        });
        const resolveCompletion = sandbox.stub().callsFake((item: { readonly label: string }) => {
            resolvedLabel = item.label;
            return Promise.resolve({
                ...item,
                insertTextFormat: "snippet" as const,
                edit: {
                    start: 5,
                    end: 8,
                    newText: "dbo.RunReport @Id = ${1:NULL}",
                },
            });
        });
        const state = {
            connectionUri: uri.toString(),
            syncedVersion: 1,
            disposed: false,
            queue: Promise.resolve(),
            features: {
                completion,
                resolveCompletion,
            },
            metadata: {},
        } as unknown as PreviewDocumentState;
        const provider = new PreviewCompletionProvider(
            () => true,
            () => state,
        );
        const document = {
            uri,
            version: 1,
            offsetAt: () => 8,
            positionAt: (offset: number) => new vscode.Position(0, offset),
        } as unknown as vscode.TextDocument;
        const cancellation = new vscode.CancellationTokenSource();
        try {
            const completion = await provider.provideCompletionItems(
                document,
                new vscode.Position(0, 8),
                cancellation.token,
            );
            const selected = completion?.items[0];
            expect(selected).not.to.equal(undefined);

            const resolved = await provider.resolveCompletionItem(selected!, cancellation.token);

            expect(resolvedLabel).to.equal("RunReport");
            expect(resolved.insertText).to.be.instanceOf(vscode.SnippetString);
            expect((resolved.insertText as vscode.SnippetString).value).to.equal(
                "dbo.RunReport @Id = ${1:NULL}",
            );
        } finally {
            cancellation.dispose();
        }
    });
});
