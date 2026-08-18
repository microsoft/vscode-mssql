/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const {
    ImmutableTextSnapshot,
    LezerSyntaxService,
    collectFoldingRanges,
} = require("../../dist/index.js");

/** Parses one document and returns its folding ranges together with the snapshot they came from. */
function fold(sql) {
    const syntax = new LezerSyntaxService().parse(
        new ImmutableTextSnapshot("file:///folding.sql", 1, sql),
    );
    const ranges = collectFoldingRanges(syntax);
    return { syntax, ranges, described: describeRanges(ranges, syntax) };
}

/** Renders ranges as `startLine-endLine kind` so assertions read like the gutter does. */
function describeRanges(ranges, syntax) {
    return ranges.map((range) => {
        const start = syntax.document.positionAt(range.start).line;
        const end = syntax.document.positionAt(range.end).line;
        return `${start}-${end} ${range.kind ?? "code"}`;
    });
}

/** Joins lines so a fixture reads as it would in the editor, with 0-based line numbers. */
function script(...lines) {
    return lines.join("\n");
}

module.exports = { describeRanges, fold, script };
