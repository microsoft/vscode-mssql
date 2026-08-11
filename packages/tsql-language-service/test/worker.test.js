/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { describe, it } = require("node:test");
const { SqlWorkerClient } = require("../dist/worker/client.js");
const { createNodeSqlWorkerClient } = require("../dist/worker/nodeClient.js");
const { SqlWorkerRequestHandler } = require("../dist/worker/requestHandler.js");

const catalog = {
    mapping: {
        TestDatabase: {
            dbo: {
                Users: {
                    Id: { type: "int", nullable: false },
                    DisplayName: { type: "nvarchar(100)", nullable: true },
                },
            },
        },
    },
    version: 1,
    world: "closed",
};

describe("SQL analysis workers", () => {
    it("runs analysis and feature computation off-thread without transferring parser state", async () => {
        const client = createNodeSqlWorkerClient();
        const uri = "file:///worker-analysis.sql";
        const text = "SELECT u. FROM dbo.Users AS u;\nGO\nSELECT 2;";
        try {
            const opened = await client.openDocument(uri, 1, text, { catalog });
            assert.equal(opened.mode, "analysis");
            assert.equal(opened.version, 1);
            assert.equal(opened.statistics.parsedBatchCount, 2);

            const completion = await client.completionAt(uri, text.indexOf("u.") + 2);
            assert.ok(completion.items.some((item) => item.label === "Id"));
            assert.ok(completion.items.some((item) => item.label === "DisplayName"));

            const snapshot = await client.snapshot(uri);
            assert.equal(snapshot.version, 1);
            assert.equal(
                snapshot.semanticDiagnostics.some((diagnostic) => diagnostic.code === "MSSQL208"),
                false,
            );
            assert.equal("ast" in snapshot, false);
            assert.equal("text" in snapshot, false);

            const changed = await client.changeDocument(uri, 2, [
                {
                    start: text.lastIndexOf("2"),
                    end: text.lastIndexOf("2") + 1,
                    text: "3",
                },
            ]);
            assert.equal(changed.version, 2);
            assert.equal(changed.statistics.parsedBatchCount, 1);
            assert.equal(changed.statistics.reusedBatchCount, 1);
        } finally {
            await client.dispose();
        }
    });

    it("offers a parse-only lane for very large documents", async () => {
        const client = createNodeSqlWorkerClient();
        const uri = "file:///worker-parse-only.sql";
        try {
            const opened = await client.openDocument(uri, 1, "SELECT 1;\nGO\nSELECT 2;", {
                mode: "parse",
            });
            assert.equal(opened.mode, "parse");
            assert.equal(opened.batchCount, 2);
            await assert.rejects(client.snapshot(uri), /parse-only mode/);
            await assert.rejects(client.completionAt(uri, 0), /parse-only mode/);
        } finally {
            await client.dispose();
        }
    });

    it("keeps the prior worker document current when an edit is rejected", async () => {
        const client = createNodeSqlWorkerClient();
        const uri = "file:///worker-invalid-edit.sql";
        try {
            await client.openDocument(uri, 1, "SELECT 1;", { mode: "analysis" });
            await assert.rejects(
                client.changeDocument(uri, 2, [{ start: 99, end: 100, text: "2" }]),
                /Invalid worker edit/,
            );
            assert.equal((await client.snapshot(uri)).version, 1);
        } finally {
            await client.dispose();
        }
    });

    it("rejects dependent edits after a failed base edit without corrupting worker text", async () => {
        const client = createNodeSqlWorkerClient();
        const uri = "file:///worker-dependent-edit.sql";
        try {
            await client.openDocument(uri, 1, "SELECT 1;", { mode: "analysis" });
            const failedBase = client.changeDocument(uri, 2, [{ start: 99, end: 100, text: "2" }]);
            const dependent = client.changeDocument(uri, 3, [{ start: 7, end: 8, text: "3" }]);
            await assert.rejects(failedBase, /Invalid worker edit/);
            await assert.rejects(dependent, /base version is stale/);
            assert.equal((await client.snapshot(uri)).version, 1);
        } finally {
            await client.dispose();
        }
    });

    it("keeps mutating worker state versioned when the caller aborts its response", async () => {
        const client = createNodeSqlWorkerClient();
        const uri = "file:///worker-aborted-open.sql";
        const controller = new AbortController();
        try {
            const opened = client.openDocument(uri, 1, "SELECT 1;", {
                mode: "analysis",
                signal: controller.signal,
            });
            controller.abort();
            await assert.rejects(opened, (error) => error?.name === "AbortError");
            assert.equal((await client.snapshot(uri)).version, 1);
        } finally {
            await client.dispose();
        }
    });

    it("rejects stale results even when the host does not cancel the old request", async () => {
        const transport = new ControlledTransport();
        const client = new SqlWorkerClient(transport);
        const uri = "file:///stale.sql";
        try {
            const first = client.openDocument(uri, 1, "SELECT 1;");
            const second = client.changeDocument(uri, 2, [{ start: 7, end: 8, text: "22" }]);
            transport.respond(transport.requests[0], { version: 1 });
            transport.respond(transport.requests[1], { version: 2 });
            await assert.rejects(first, /Discarded stale SQL worker result/);
            assert.deepEqual(await second, { version: 2 });
        } finally {
            await client.dispose();
        }
    });

    it("drops aborted responses and sends cancellation to the worker transport", async () => {
        const transport = new ControlledTransport();
        const client = new SqlWorkerClient(transport);
        const controller = new AbortController();
        try {
            const pending = client.openDocument("file:///abort.sql", 1, "SELECT 1;", {
                signal: controller.signal,
            });
            controller.abort();
            await assert.rejects(pending, (error) => error?.name === "AbortError");
            assert.deepEqual(transport.requests.at(-1), { type: "cancel", id: 1 });
        } finally {
            await client.dispose();
        }
    });

    it("does not retain cancellation markers for requests that are no longer active", async () => {
        const handler = new SqlWorkerRequestHandler();
        await handler.handle({ type: "cancel", id: 7 });
        const response = await handler.handle({
            type: "open",
            id: 7,
            uri: "file:///reused-request-id.sql",
            version: 1,
            text: "SELECT 1;",
            mode: "parse",
        });
        assert.equal(response.ok, true);
    });

    it("produces browser bundles without Node worker dependencies", () => {
        for (const name of ["browserClient.mjs", "browserWorker.mjs"]) {
            const file = path.join(__dirname, "..", "dist", "worker", name);
            const source = fs.readFileSync(file, "utf8");
            assert.ok(source.length > 0);
            assert.equal(source.includes("node:worker_threads"), false);
            assert.equal(source.includes('require("node:'), false);
        }
    });

    it("runs the browser client bundle over a Web Worker-shaped transport", async () => {
        const module = await import(
            pathToFileURL(path.join(__dirname, "..", "dist", "worker", "browserClient.mjs")).href
        );
        const worker = new InMemoryBrowserWorker();
        const client = module.createBrowserSqlWorkerClient(worker);
        try {
            const result = await client.openDocument(
                "file:///browser-worker.sql",
                1,
                "SELECT 1;\nGO\nSELECT 2;",
                { mode: "parse" },
            );
            assert.equal(result.batchCount, 2);
            assert.equal(result.mode, "parse");
        } finally {
            await client.dispose();
        }
        assert.equal(worker.terminated, true);
    });
});

class ControlledTransport {
    requests = [];
    onMessage = () => {};
    onError = () => {};

    postMessage(message) {
        this.requests.push(message);
    }

    subscribe(onMessage, onError) {
        this.onMessage = onMessage;
        this.onError = onError;
        return () => {};
    }

    respond(request, result) {
        this.onMessage({
            type: "response",
            id: request.id,
            ok: true,
            documentVersion: request.version,
            result,
        });
    }

    terminate() {}
}

class InMemoryBrowserWorker {
    handler = new SqlWorkerRequestHandler();
    listeners = new Map();
    terminated = false;

    postMessage(message) {
        queueMicrotask(async () => {
            const response = await this.handler.handle(message);
            for (const listener of this.listeners.get("message") ?? []) {
                listener({ data: response });
            }
        });
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }

    terminate() {
        this.terminated = true;
    }
}
