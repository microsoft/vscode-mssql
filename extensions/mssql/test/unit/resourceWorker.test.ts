/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from "assert";
import {
    createResourceWorker,
    type ResourceWorkerDependencies,
} from "../../src/webviews/pages/QueryStudio/spatial/resourceWorker";

suite("webview resource worker", () => {
    test("launches a fetched local bundle from a blob and disposes exactly once", async () => {
        const calls: string[] = [];
        const fakeWorker = {
            terminate: () => {
                calls.push("terminate");
            },
        } as unknown as Worker;
        const dependencies: ResourceWorkerDependencies = {
            fetchResource: async (url) => {
                calls.push(`fetch:${url.pathname}`);
                return new Response("self.postMessage('ready')", { status: 200 });
            },
            createObjectUrl: asyncBlob("blob:spatial", calls),
            revokeObjectUrl: (url) => calls.push(`revoke:${url}`),
            createWorker: (url) => {
                calls.push(`worker:${url}`);
                return fakeWorker;
            },
        };
        const result = await createResourceWorker(
            new URL("https://resource.invalid/spatialDecodeWorker.js"),
            dependencies,
        );
        result.dispose();
        result.dispose();
        assert.deepEqual(calls, [
            "fetch:/spatialDecodeWorker.js",
            "blob",
            "worker:blob:spatial",
            "terminate",
            "revoke:blob:spatial",
        ]);
    });

    test("refuses a missing resource before creating a worker", async () => {
        await assert.rejects(
            createResourceWorker(new URL("https://resource.invalid/missing.js"), {
                fetchResource: async () => new Response("missing", { status: 404 }),
                createObjectUrl: () => "blob:unused",
                revokeObjectUrl: () => undefined,
                createWorker: () => {
                    throw new Error("must not run");
                },
            }),
            /404/,
        );
    });
});

function asyncBlob(value: string, calls: string[]): (blob: Blob) => string {
    return () => {
        calls.push("blob");
        return value;
    };
}
