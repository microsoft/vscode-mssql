/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as vscode from "vscode";
import { PreviewCompletionProvider } from "../../src/languageservice/preview/previewVscodeFeatureProviders";
import type { PreviewDocumentState } from "../../src/languageservice/preview/previewLanguageServiceState";

suite("Preview completion metadata hydration", () => {
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
});
