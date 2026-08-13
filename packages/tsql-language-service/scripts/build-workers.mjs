#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { build } from "esbuild";

await Promise.all([
    build({
        entryPoints: ["src/worker/browser/client.mts"],
        outfile: "dist/worker/browser/client.mjs",
        bundle: true,
        platform: "browser",
        format: "esm",
        target: "es2022",
        sourcemap: true,
        sourcesContent: false,
        legalComments: "none",
    }),
    build({
        entryPoints: ["src/worker/browser/worker.mts"],
        outfile: "dist/worker/browser/worker.mjs",
        bundle: true,
        platform: "browser",
        format: "esm",
        target: "es2022",
        sourcemap: true,
        sourcesContent: false,
        legalComments: "none",
    }),
]);
