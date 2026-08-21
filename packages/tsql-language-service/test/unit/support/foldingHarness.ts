/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ImmutableTextSnapshot,
    LezerSyntaxService,
    collectFoldingRanges,
    type FoldingRange,
    type SyntaxSnapshot,
} from "../../../src/index.ts";

export function fold(sql: string): {
    readonly syntax: SyntaxSnapshot;
    readonly ranges: readonly FoldingRange[];
    readonly described: readonly string[];
} {
    const syntax = new LezerSyntaxService().parse(
        new ImmutableTextSnapshot("file:///folding.sql", 1, sql),
    );
    const ranges = collectFoldingRanges(syntax);
    return { syntax, ranges, described: describeRanges(ranges, syntax) };
}

export function describeRanges(ranges: readonly FoldingRange[], syntax: SyntaxSnapshot): string[] {
    return ranges.map((range) => {
        const start = syntax.document.positionAt(range.start).line;
        const end = syntax.document.positionAt(range.end).line;
        return `${start}-${end} ${range.kind ?? "code"}`;
    });
}

export function script(...lines: readonly string[]): string {
    return lines.join("\n");
}
