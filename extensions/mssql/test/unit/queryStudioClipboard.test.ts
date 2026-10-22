/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { QsWriteClipboardRequest } from "../../src/sharedInterfaces/queryStudio";
import {
    writeQueryStudioClipboard,
    type QueryStudioClipboardWriter,
} from "../../src/webviews/pages/QueryStudio/queryStudioClipboard";
import type { Rpc } from "../../src/webviews/pages/QueryStudio/resultsGridShared";

suite("Query Studio clipboard", () => {
    let requests: Array<{ method: string; params: unknown }>;
    let rpc: Rpc;

    setup(() => {
        requests = [];
        rpc = {
            sendRequest: async <P, R>(type: { method: string }, params: P): Promise<R> => {
                requests.push({ method: type.method, params });
                return { written: true } as R;
            },
        };
    });

    test("uses the webview clipboard without an extra RPC", async () => {
        const writes: string[] = [];
        const writeText = async (text: string): Promise<void> => {
            writes.push(text);
        };
        const result = await writeQueryStudioClipboard(rpc, "exact text", {
            writeText,
        } satisfies QueryStudioClipboardWriter);

        expect(result).to.deep.equal({ attempts: 1, mode: "webview" });
        expect(writes).to.deep.equal(["exact text"]);
        expect(requests).to.be.empty;
    });

    test("falls back to the VS Code host after a webview clipboard failure", async () => {
        const writeText = async (): Promise<void> => {
            throw new Error("clipboard unavailable");
        };
        const result = await writeQueryStudioClipboard(rpc, "exact text", {
            writeText,
        } satisfies QueryStudioClipboardWriter);

        expect(result).to.deep.equal({ attempts: 2, mode: "hostFallback" });
        expect(requests).to.deep.equal([
            {
                method: QsWriteClipboardRequest.type.method,
                params: { text: "exact text" },
            },
        ]);
    });
});
