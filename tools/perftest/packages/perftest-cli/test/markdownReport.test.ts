/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from "vitest";
import { renderMarkdownReport } from "../src/report/markdownReport";

describe("Markdown report", () => {
    it("escapes table-breaking metadata", () => {
        const report = renderMarkdownReport({
            runId: "run-1",
            passType: "measurement",
            createdAt: "2026-08-25T00:00:00Z",
            environmentHash: "sha256:abc",
            machineId: "host|pool\nsecond-line",
            vscodeVersion: "1.105.0|insiders",
            results: [],
            harnessLogPath: "harness-log.jsonl",
        });

        expect(report).toContain("| Machine | host\\|pool second-line |");
        expect(report).toContain("| VS Code | 1.105.0\\|insiders |");
    });
});
