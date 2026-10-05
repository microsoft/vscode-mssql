/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from "vitest";
import { selectRendererTraceTarget } from "../src/collectors/cdpRendererTrace";
import { ensureCdpRemoteDebuggingPort, isMssqlWebviewTarget } from "../src/collectors/cdpClient";

describe("cdpRendererTrace target selection", () => {
    it("uses the workbench target that exposes the Chromium Tracing domain", () => {
        const selected = selectRendererTraceTarget([
            {
                type: "page",
                url: "vscode-file://vscode-app/workbench.html",
                webSocketDebuggerUrl: "ws://workbench",
            },
            {
                type: "iframe",
                url: "vscode-webview://authority/index.html?extensionId=ms-mssql.mssql&id=opaque",
                webSocketDebuggerUrl: "ws://query-studio",
            },
        ]);

        expect(selected).toEqual({
            target: expect.objectContaining({
                webSocketDebuggerUrl: "ws://workbench",
            }),
            scope: "workbenchRendererProcessWindow",
        });
    });

    it("falls back honestly when webviews are not debuggable", () => {
        const selected = selectRendererTraceTarget([
            {
                type: "iframe",
                url: "vscode-webview://authority/index.html?extensionId=ms-mssql.mssql",
            },
            {
                type: "page",
                url: "vscode-file://vscode-app/workbench.html",
                webSocketDebuggerUrl: "ws://workbench",
            },
        ]);

        expect(selected?.scope).toBe("workbenchRendererProcessWindow");
    });

    it("shares one debug port and classifies only the MSSQL webview origin", () => {
        const args: string[] = [];
        const first = ensureCdpRemoteDebuggingPort(args);
        const second = ensureCdpRemoteDebuggingPort(args);

        expect(second).toBe(first);
        expect(args).toEqual([`--remote-debugging-port=${first}`]);
        expect(
            isMssqlWebviewTarget({
                url: "vscode-webview://authority/index.html?extensionId=ms-mssql.mssql",
            }),
        ).toBe(true);
        expect(
            isMssqlWebviewTarget({
                url: "vscode-webview://authority/index.html?extensionId=another.extension",
            }),
        ).toBe(false);
    });
});
