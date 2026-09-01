/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    createErrorLineLink,
    parseErrorLine,
    toDocumentSelection,
} from "../../src/queryResult/messageLinks";
import { ISelectionData } from "../../src/models/interfaces";
import { splitMessages } from "../../src/webviews/pages/QueryResult/queryResultUtils";
import * as qr from "../../src/sharedInterfaces/queryResult";

const batchAt = (startLine: number): ISelectionData => ({
    startLine,
    startColumn: 0,
    endLine: startLine + 20,
    endColumn: 0,
});

suite("Query message links", () => {
    suite("parseErrorLine", () => {
        test("reads the line out of a standard error header", () => {
            const parsed = parseErrorLine("Msg 102, Level 15, State 1, Line 11");

            expect(parsed).to.deep.equal({ text: "Line 11", batchLine: 11 });
        });

        test("reads the line when the header names a procedure", () => {
            const parsed = parseErrorLine("Msg 2812, Level 16, State 62, Procedure myProc, Line 4");

            expect(parsed).to.deep.equal({ text: "Line 4", batchLine: 4 });
        });

        test("takes the error line rather than the batch start line that follows it", () => {
            const parsed = parseErrorLine(
                "Msg 208, Level 16, State 1, Line 3 [Batch Start Line 0]",
            );

            expect(parsed).to.deep.equal({ text: "Line 3", batchLine: 3 });
        });

        test("reads a line from a message that continues onto another line", () => {
            const parsed = parseErrorLine(
                "Msg 102, Level 15, State 1, Line 11\r\nIncorrect syntax near ','.",
            );

            expect(parsed?.batchLine).to.equal(11);
        });

        test("ignores text that is not an error header", () => {
            expect(parseErrorLine("Commands completed successfully.")).to.be.undefined;
            expect(parseErrorLine("(3 rows affected)")).to.be.undefined;
            // "Line" on its own is not enough; the message must be an error header
            expect(parseErrorLine("Started executing query at Line 5")).to.be.undefined;
        });

        test("ignores an empty or missing message", () => {
            expect(parseErrorLine(undefined)).to.be.undefined;
            expect(parseErrorLine("")).to.be.undefined;
        });

        test("ignores a header that reports a line of zero", () => {
            expect(parseErrorLine("Msg 102, Level 15, State 1, Line 0")).to.be.undefined;
        });
    });

    suite("toDocumentSelection", () => {
        test("maps the first line of a batch to the batch's own start line", () => {
            const selection = toDocumentSelection(batchAt(0), 1);

            expect(selection).to.deep.equal({
                startLine: 0,
                startColumn: 0,
                endLine: 0,
                endColumn: 0,
            });
        });

        test("offsets the reported line by where the batch starts", () => {
            // batch starts on document line 40 (0-based), server reports its line 11
            const selection = toDocumentSelection(batchAt(40), 11);

            expect(selection.startLine).to.equal(50);
            expect(selection.endLine).to.equal(50);
        });

        test("collapses to a cursor position rather than selecting a range", () => {
            const selection = toDocumentSelection(batchAt(7), 3);

            expect(selection.startLine).to.equal(selection.endLine);
            expect(selection.startColumn).to.equal(0);
            expect(selection.endColumn).to.equal(0);
        });
    });

    suite("createErrorLineLink", () => {
        test("builds a link for an error inside a batch further down the file", () => {
            const link = createErrorLineLink(
                "Msg 102, Level 15, State 1, Line 11\nIncorrect syntax near ','.",
                batchAt(40),
            );

            expect(link?.text).to.equal("Line 11");
            expect(link?.selection.startLine).to.equal(50);
        });

        test("produces nothing when the batch is unknown", () => {
            const link = createErrorLineLink("Msg 102, Level 15, State 1, Line 11", undefined);

            expect(link).to.be.undefined;
        });

        test("produces nothing for a message with no line in it", () => {
            expect(createErrorLineLink("Incorrect syntax near ','.", batchAt(0))).to.be.undefined;
        });
    });

    suite("splitMessages", () => {
        test("keeps the link only on the line whose text it came from", () => {
            const messages: qr.IMessage[] = [
                {
                    message: "Msg 102, Level 15, State 1, Line 11\nIncorrect syntax near ','.",
                    isError: true,
                    link: { text: "Line 11", uri: "file:///q.sql" },
                    selection: { startLine: 50, startColumn: 0, endLine: 50, endColumn: 0 },
                },
            ];

            const split = splitMessages(messages);

            expect(split).to.have.lengthOf(2);
            expect(split[0].link?.text).to.equal("Line 11");
            expect(split[0].selection?.startLine).to.equal(50);
            // the continuation line must not repeat the link
            expect(split[1].link).to.be.undefined;
            expect(split[1].selection).to.be.undefined;
        });

        test("leaves a single line message with its link", () => {
            const messages: qr.IMessage[] = [
                {
                    message: "Started executing query at ",
                    isError: false,
                    link: { text: "Line 5", uri: "file:///q.sql" },
                    selection: { startLine: 4, startColumn: 0, endLine: 4, endColumn: 0 },
                },
            ];

            const split = splitMessages(messages);

            expect(split).to.have.lengthOf(1);
            expect(split[0].link?.text).to.equal("Line 5");
        });

        test("still splits messages that carry no link", () => {
            const messages: qr.IMessage[] = [{ message: "one\ntwo\nthree", isError: false }];

            const split = splitMessages(messages);

            expect(split.map((m) => m.message)).to.deep.equal(["one", "two", "three"]);
        });

        test("returns an empty array for no messages", () => {
            expect(splitMessages([])).to.deep.equal([]);
            expect(splitMessages(undefined)).to.deep.equal([]);
            expect(splitMessages(null)).to.deep.equal([]);
        });
    });
});
