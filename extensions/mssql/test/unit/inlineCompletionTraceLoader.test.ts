/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expect } from "chai";
import {
    loadTraceFile,
    scanTraceFolder,
} from "../../src/copilot/inlineCompletionDebug/traceLoader";

suite("Inline completion trace loader", () => {
    let tempFolder: string;

    setup(async () => {
        tempFolder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mssql-traces-test-"));
    });

    teardown(async () => {
        await fs.promises.rm(tempFolder, { recursive: true, force: true });
    });

    test("scans trace files and builds index metadata", async () => {
        await writeTrace("mssql-copilot-trace-2026-04-01T00-00-00-000Z.json", [
            { id: "E-1", timestamp: 1000 },
            { id: "E-2", timestamp: 3000 },
        ]);
        await writeTrace("mssql-copilot-trace-2026-04-02T00-00-00-000Z.json", [
            { id: "E-3", timestamp: 5000 },
        ]);
        await fs.promises.writeFile(path.join(tempFolder, "ignore.json"), "{}", "utf8");

        const index = await scanTraceFolder(tempFolder);

        expect(index).to.have.lengthOf(2);
        expect(index.map((entry) => entry.eventCount).sort()).to.deep.equal([1, 2]);
        expect(index.find((entry) => entry.eventCount === 2)?.dateRange).to.deep.equal({
            start: 1000,
            end: 3000,
        });
        expect(index.every((entry) => entry.included)).to.equal(true);
    });

    test("loads and validates a trace file", async () => {
        const filePath = await writeTrace("mssql-copilot-trace-2026-04-01T00-00-00-000Z.json", [
            { id: "E-1", timestamp: 1000 },
        ]);

        const trace = await loadTraceFile(filePath);

        expect(trace.version).to.equal(1);
        expect(trace._extensionVersion).to.equal("1.43.0-test");
        expect(trace.events).to.have.lengthOf(1);
    });

    async function writeTrace(
        filename: string,
        events: Array<{ id: string; timestamp: number }>,
    ): Promise<string> {
        const filePath = path.join(tempFolder, filename);
        await fs.promises.writeFile(
            filePath,
            JSON.stringify({
                version: 1,
                exportedAt: events[0]?.timestamp ?? 0,
                _savedAt: new Date(events[0]?.timestamp ?? 0).toISOString(),
                _extensionVersion: "1.43.0-test",
                overrides: {
                    profileId: "balanced",
                    modelSelector: null,
                    continuationModelSelector: null,
                    useSchemaContext: true,
                    debounceMs: null,
                    maxTokens: null,
                    enabledCategories: null,
                    forceIntentMode: null,
                    customSystemPrompt: null,
                    allowAutomaticTriggers: null,
                    schemaContext: { columnRepresentation: "compact" },
                },
                recordWhenClosed: true,
                events: events.map((event) => ({
                    ...event,
                    documentUri: "file:///query.sql",
                    documentFileName: "query.sql",
                    line: 1,
                    column: 1,
                    triggerKind: "automatic",
                    explicitFromUser: false,
                    completionCategory: "intent",
                    intentMode: true,
                    inferredSystemQuery: false,
                    modelFamily: "claude-sonnet-4-6",
                    modelId: "claude-sonnet-4-6",
                    modelVendor: "anthropic-api",
                    result: "accepted",
                    latencyMs: 100,
                    inputTokens: 1000,
                    outputTokens: 100,
                    schemaObjectCount: 4,
                    schemaSystemObjectCount: 1,
                    schemaForeignKeyCount: 0,
                    usedSchemaContext: true,
                    overridesApplied: {
                        profileId: "balanced",
                        schemaContext: { columnRepresentation: "compact" },
                        customSystemPromptUsed: false,
                    },
                    promptMessages: [],
                    rawResponse: "",
                    locals: {
                        "document.languageId": "sql",
                        schemaSizeKind: "small",
                    },
                })),
            }),
            "utf8",
        );
        return filePath;
    }
});
