/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import type { Tree } from "@lezer/common";

import type { TsqlFeatureProfile } from "../../../src/common/engineCapabilities.ts";
import type { SyntaxService, SyntaxSnapshot } from "../../../src/syntax/contracts.ts";
import type { TextChange, TextSnapshot } from "../../../src/text/contracts.ts";
import { ImmutableTextSnapshot, applyTextChanges } from "../../../src/text/textSnapshot.ts";
import { LezerSyntaxService } from "../../../src/syntax/lezer/lezerSyntaxService.ts";

export type GrammarSyntaxSnapshot = SyntaxSnapshot & {
    readonly tree: Tree;
};

export function lezerTree(snapshot: SyntaxSnapshot): Tree {
    return (snapshot as GrammarSyntaxSnapshot).tree;
}

export function syntaxTree(snapshot: SyntaxSnapshot): string {
    return lezerTree(snapshot).toString();
}

/** Creates one small, public-API syntax harness for a grammar domain. */
export function createSyntaxHarness(fileName = "syntax.sql", defaultProfile?: TsqlFeatureProfile) {
    const uri = fileName.includes(":") ? fileName : `file:///${fileName}`;

    function document(version: number, text: string): ImmutableTextSnapshot {
        return new ImmutableTextSnapshot(uri, version, text);
    }

    function parse(sql: string, profile = defaultProfile): GrammarSyntaxSnapshot {
        return new LezerSyntaxService(undefined, profile).parse(
            document(1, sql),
        ) as GrammarSyntaxSnapshot;
    }

    function assertValid(
        value: string | GrammarSyntaxSnapshot,
        profile = defaultProfile,
    ): GrammarSyntaxSnapshot {
        const snapshot = typeof value === "string" ? parse(value, profile) : value;
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(snapshot.diagnostics, []);
        return snapshot;
    }

    return Object.freeze({ assertValid, document, parse, uri });
}

interface IncrementalEquivalentOptions {
    readonly service: SyntaxService;
    readonly previousDocument: TextSnapshot;
    readonly previousSnapshot: SyntaxSnapshot;
    readonly version: number;
    readonly changes: readonly TextChange[];
    readonly assertReuse?: boolean;
}

/** Verifies that applying an edit incrementally produces the same public syntax result as fresh parsing. */
export function assertIncrementalEquivalent({
    service,
    previousDocument,
    previousSnapshot,
    version,
    changes,
    assertReuse = true,
}: IncrementalEquivalentOptions) {
    const nextDocument = applyTextChanges(previousDocument, version, changes);
    const incremental = service.update(
        previousSnapshot,
        nextDocument,
        changes,
    ) as GrammarSyntaxSnapshot;
    const fresh = service.parse(nextDocument) as GrammarSyntaxSnapshot;

    if (assertReuse) assert.ok(incremental.statistics.reusedChunkCount > 0);
    assert.equal(incremental.tree.toString(), fresh.tree.toString());
    assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
    assert.deepEqual([...incremental.tokens()], [...fresh.tokens()]);
    return { fresh, incremental, nextDocument };
}
