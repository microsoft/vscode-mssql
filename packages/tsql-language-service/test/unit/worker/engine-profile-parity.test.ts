/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    InProcessLanguageServiceRuntime,
    LanguageServiceWorkerClient,
    LezerSyntaxService,
    WorkerRequestHandler,
} from "../../../src/index.ts";
import type { EngineFacts } from "../../../src/common/engineProfile.ts";
import type { WorkerRequest } from "../../../src/worker/protocol.ts";
import { createSourceNodeWorkerClient } from "../support/nodeWorkerClient.ts";

const uri = "file:///worker-profile.sql";
const sql = "BACKUP DATABASE db TO DISK = 'db.bak';\nSELECT a FROM t ORDER BY ALL;";
const azureFacts: EngineFacts = { engineEdition: 5, compatibilityLevel: 170 };

/**
 * Drives the shared request handler directly. The browser worker entry point is nothing but a
 * `postMessage` adapter over this handler, so exercising it here covers browser behavior without
 * requiring a DOM.
 */
function createInlineWorkerClient(): LanguageServiceWorkerClient {
    const handler = new WorkerRequestHandler();
    let onMessage: (message: unknown) => void = () => {};
    return new LanguageServiceWorkerClient({
        postMessage(message) {
            void handler.handle(message).then((response) => onMessage(response));
        },
        subscribe(next) {
            onMessage = next;
            return () => {
                onMessage = () => {};
            };
        },
        terminate() {},
    });
}

suite("engine profile parity across runtimes", () => {
    // Verifies the in-process runtime, the Node worker, and the shared handler the browser worker
    // wraps all resolve the same profile from the same facts and publish the same counts.
    test("in-process, Node worker, and browser handler agree", async () => {
        const inProcess = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(undefined, { engineProfile: "unknown", previewFeatures: false }),
        );
        await inProcess.open(uri, 1, sql);
        await inProcess.setEngineFacts(azureFacts);
        const local = inProcess.snapshot(uri, 1);

        const clients = [createSourceNodeWorkerClient(), createInlineWorkerClient()];
        try {
            for (const client of clients) {
                const capabilities = await client.setEngineFacts(azureFacts);
                assert.equal(capabilities.profile, "azure-sql-database");
                assert.equal(capabilities.generation, local.syntax.profileGeneration);

                const opened = await client.open(uri, 1, sql);
                assert.equal(opened.profileGeneration, local.syntax.profileGeneration);
                assert.equal(opened.syntaxErrorCount, local.syntax.diagnostics.length);
                assert.equal(opened.availabilityDiagnosticCount, 2);
            }
        } finally {
            await Promise.all(clients.map((client) => client.dispose()));
        }
    });

    // Verifies a worker reprofiles documents that are already open, exactly as the runtime does.
    test("a worker reprofiles documents opened before the facts arrived", async () => {
        const client = createInlineWorkerClient();
        try {
            const opened = await client.open(uri, 1, sql);
            assert.equal(opened.profileGeneration, "unknown/?/?/ga");
            assert.equal(opened.availabilityDiagnosticCount, 0);

            await client.setEngineFacts(azureFacts);
            const stats = await client.stats(uri);
            assert.equal(stats.engine.profile, "azure-sql-database");
            assert.equal(stats.engine.generation, "azure-sql-database/17/170/ga");
        } finally {
            await client.dispose();
        }
    });

    // Documents connected to different servers keep independent profiles inside one worker.
    test("keeps engine profiles per document", async () => {
        const client = createInlineWorkerClient();
        const other = "file:///worker-fabric.sql";
        try {
            await client.open(uri, 1, sql);
            await client.open(other, 1, "SELECT 1;");
            await client.setDocumentEngineFacts(uri, azureFacts);
            await client.setDocumentEngineFacts(other, {
                engineProfile: "fabric-warehouse",
                engineEdition: 11,
            });

            assert.equal((await client.stats(uri)).engine.profile, "azure-sql-database");
            assert.equal((await client.stats(other)).engine.profile, "fabric-warehouse");
        } finally {
            await client.dispose();
        }
    });

    // The worker boundary returns editor features, not only parse counters and status summaries.
    test("serves document-local language features from the retained worker snapshot", async () => {
        const client = createInlineWorkerClient();
        const featureUri = "file:///worker-features.sql";
        const text = "DECLARE @value int;\nSELECT @value;";
        try {
            await client.open(featureUri, 1, text);
            assert.deepEqual(await client.diagnostics(featureUri), {
                syntax: [],
                semantic: [],
            });
            assert.ok((await client.completion(featureUri, text.length)).items.length > 0);
            assert.ok((await client.references(featureUri, text.lastIndexOf("@value"))).length > 0);
            assert.ok((await client.documentSymbols(featureUri)).length > 0);
            assert.ok((await client.selectionRanges(featureUri, [text.length - 1])).length > 0);
            assert.ok((await client.coloring(featureUri)).tokens.length > 0);
        } finally {
            await client.dispose();
        }
    });

    // Verifies nothing but plain facts crosses the boundary.
    test("only serializable facts cross the worker boundary", async () => {
        const sent: WorkerRequest[] = [];
        const handler = new WorkerRequestHandler();
        let onMessage: (message: unknown) => void = () => {};
        const client = new LanguageServiceWorkerClient({
            postMessage(message) {
                sent.push(message);
                void handler.handle(message).then((response) => onMessage(response));
            },
            subscribe(next) {
                onMessage = next;
                return () => {};
            },
            terminate() {},
        });
        try {
            await client.setEngineFacts({
                engineEdition: 8,
                serverName: "mi.database.windows.net",
                compatibilityLevel: 160,
            });
            const request = sent.find((message) => message.type === "engineFacts");
            assert.ok(request?.type === "engineFacts" && request.facts);
            assert.deepEqual(JSON.parse(JSON.stringify(request)), request);
            assert.deepEqual(Object.keys(request.facts).sort(), [
                "compatibilityLevel",
                "engineEdition",
                "serverName",
            ]);
        } finally {
            await client.dispose();
        }
    });
});
