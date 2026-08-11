/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { build } from "esbuild";

const shared = {
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    sourcemap: true,
    sourcesContent: false,
    legalComments: "none",
    logLevel: "warning",
};

await Promise.all([
    build({
        ...shared,
        entryPoints: ["src/worker/browserClient.mts"],
        outfile: "dist/worker/browserClient.mjs",
    }),
    build({
        ...shared,
        entryPoints: ["src/worker/browserWorker.mts"],
        outfile: "dist/worker/browserWorker.mjs",
    }),
]);
