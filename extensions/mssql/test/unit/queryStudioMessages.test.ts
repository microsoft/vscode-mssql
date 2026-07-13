/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type { QsMessageRow } from "../../src/sharedInterfaces/queryStudio";
import {
    updateQueryStudioMessageOffsetIndex,
    type QueryStudioMessageOffsetIndex,
} from "../../src/sharedInterfaces/queryStudioMessages";
import {
    appendPositionedQueryStudioMessages,
    queryStudioMessageWindow,
} from "../../src/sharedInterfaces/queryStudioMessageWindows";

function message(text: string, kind: QsMessageRow["kind"] = "info"): QsMessageRow {
    return { batchIndex: 0, kind, text, epochMs: 1 };
}

suite("Query Studio message windows and offsets", () => {
    test("bounds catch-up by count and reports absolute continuation", () => {
        const messages = ["a", "b", "c", "d", "e"].map((text) => message(text));
        expect(queryStudioMessageWindow(messages, 1, 2, 100)).to.deep.equal({
            startIndex: 1,
            nextIndex: 3,
            totalCount: 5,
            textCharacters: 2,
            hasMore: true,
            messages: [messages[1], messages[2]],
        });
        expect(queryStudioMessageWindow(messages, 4, 2, 100).hasMore).to.equal(false);
    });

    test("bounds catch-up by text characters while always making progress", () => {
        const messages = [message("aaa"), message("bbbb"), message("c")];
        const first = queryStudioMessageWindow(messages, 0, 10, 5);
        expect(first.messages).to.deep.equal([messages[0]]);
        expect(first.nextIndex).to.equal(1);
        expect(first.textCharacters).to.equal(3);

        const rest = queryStudioMessageWindow(messages, 1, 10, 5);
        expect(rest.messages).to.deep.equal([messages[1], messages[2]]);
        expect(rest.textCharacters).to.equal(5);

        const oversized = queryStudioMessageWindow([message("x".repeat(20))], 0, 10, 3);
        expect(oversized.messages).to.have.length(1);
        expect(oversized.nextIndex).to.equal(1);
    });

    test("clamps invalid positions to the available message range", () => {
        const messages = [message("a"), message("b")];
        expect(queryStudioMessageWindow(messages, -10).startIndex).to.equal(0);
        expect(queryStudioMessageWindow(messages, Number.NaN).startIndex).to.equal(0);
        expect(queryStudioMessageWindow(messages, 99)).to.deep.include({
            startIndex: 2,
            nextIndex: 2,
            hasMore: false,
        });
    });

    test("positioned merges append only missing rows and refuse gaps", () => {
        const a = message("a");
        const b = message("b");
        const c = message("c");
        const current = [a, b];
        expect(appendPositionedQueryStudioMessages(current, 1, [b, c])).to.deep.equal([a, b, c]);
        expect(appendPositionedQueryStudioMessages(current, 0, [a, b])).to.equal(current);
        expect(appendPositionedQueryStudioMessages(current, 3, [c])).to.equal(current);
        expect(appendPositionedQueryStudioMessages(current, Number.NaN, [a, b, c])).to.deep.equal([
            a,
            b,
            c,
        ]);
    });

    test("extends the height index only for appended messages", () => {
        const first = message("one");
        const second = message("two\ncontinued");
        const third = message("three");
        const initial: QueryStudioMessageOffsetIndex = { messages: [], offsets: [0] };
        const two = updateQueryStudioMessageOffsetIndex(initial, [first, second], 18);
        expect(two).to.equal(initial);
        expect(two.offsets).to.deep.equal([0, 18, 54]);

        const offsets = two.offsets;
        const three = updateQueryStudioMessageOffsetIndex(two, [first, second, third], 18);
        expect(three).to.equal(two);
        expect(three.offsets).to.equal(offsets);
        expect(three.offsets).to.deep.equal([0, 18, 54, 72]);
    });

    test("rebuilds the height index when a new run replaces messages", () => {
        const old = [message("old"), message("old\nline")];
        const initial = updateQueryStudioMessageOffsetIndex(
            { messages: [], offsets: [0] },
            old,
            10,
        );
        const replacement = [message("new\nline\nthree")];
        const rebuilt = updateQueryStudioMessageOffsetIndex(initial, replacement, 10);
        expect(rebuilt).not.to.equal(initial);
        expect(rebuilt.offsets).to.deep.equal([0, 30]);
        expect(initial.offsets).to.deep.equal([0, 10, 30]);
    });
});
