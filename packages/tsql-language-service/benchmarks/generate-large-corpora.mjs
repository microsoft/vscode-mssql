#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { materializeLargeCorpora } from "./large-corpora.mjs";

const manifest = await materializeLargeCorpora();

console.table(
    manifest.map((entry) => ({
        file: entry.name,
        bytes: entry.bytes,
        MiB: entry.mebibytes,
        batches: entry.batchCount,
        statements: entry.logicalStatements,
        sha256: entry.sha256,
    })),
);
console.log(`Generated ${manifest.length} exact-size SQL corpora in benchmarks/generated/.`);
