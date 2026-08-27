/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as http from "http";
import { diag, DiagnosticSink } from "../../src/diagnostics/diagnosticsCore";
import { startStsDiagListener, stopStsDiagListener } from "../../src/diagnostics/stsDiagListener";
import { DiagEvent } from "../../src/sharedInterfaces/debugConsole";

async function post(url: string, authorization: string, body: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        const target = new URL(url);
        const request = http.request(
            {
                hostname: target.hostname,
                port: target.port,
                path: target.pathname,
                method: "POST",
                headers: {
                    authorization,
                    "content-length": Buffer.byteLength(body),
                    "content-type": "application/x-ndjson",
                },
            },
            (response) => {
                response.resume();
                response.on("end", () => resolve(response.statusCode ?? 0));
            },
        );
        request.on("error", reject);
        request.end(body);
    });
}

async function eventually(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (!predicate()) {
        if (Date.now() >= deadline) {
            throw new Error("condition was not met before timeout");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

suite("STS diagnostics listener", () => {
    teardown(() => {
        diag.removeSink("sts-listener-test");
        stopStsDiagListener();
    });

    test("accepts only bounded authenticated NDJSON and classifies STS metadata", async () => {
        const received: DiagEvent[] = [];
        const sink: DiagnosticSink = {
            id: "sts-listener-test",
            tryWrite: (event) => received.push(event),
        };
        diag.addSink(sink);
        await startStsDiagListener();

        const url = process.env["STS_DIAG_URL"];
        const token = process.env["STS_DIAG_TOKEN"];
        expect(url).to.be.a("string");
        expect(token).to.be.a("string");

        expect(await post(url!, "Bearer wrong", "{}\n")).to.equal(403);
        expect(received).to.deep.equal([]);

        const wireEvent = {
            type: "sts.rpc.dispatch.end",
            feature: "rpc",
            kind: "span",
            status: "warning",
            epochMs: 2_000,
            startEpochMs: 1_500,
            durationMs: 500,
            pid: 42,
            fields: { method: "query/execute", count: 3, nested: { refused: true } },
        };
        expect(
            await post(url!, `Bearer ${token}`, `${JSON.stringify(wireEvent)}\nmalformed-json\n`),
        ).to.equal(200);
        await eventually(() => received.length === 1);

        expect(received[0]).to.include({
            type: "sts.rpc.dispatch.end",
            feature: "rpc",
            kind: "span",
            status: "warning",
            process: "sqlToolsService",
            pid: 42,
            epochMs: 1_500,
            durationMs: 500,
            timingClass: "epochAlignedDiagnostic",
        });
        expect(received[0].tags).to.deep.equal(["stsDiag"]);
        expect(received[0].payload?.["method"]).to.include({
            v: "query/execute",
            cls: "diagnostic.metadata",
            handling: "plain",
        });
        expect(received[0].payload?.["count"].v).to.equal(3);
        expect(received[0].payload).not.to.have.property("nested");

        const oversized = "x".repeat(4 * 1024 * 1024 + 1);
        expect(await post(url!, `Bearer ${token}`, oversized)).to.equal(413);
        expect(received).to.have.length(1);
    });
});
