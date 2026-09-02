/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { ISelectionData } from "../../src/models/interfaces";
import { createErrorMessageNavigation } from "../../src/queryResult/messageLinks";
import * as qr from "../../src/sharedInterfaces/queryResult";
import { splitMessages } from "../../src/webviews/pages/QueryResult/queryResultUtils";

suite("Query message links", () => {
    const errorSelection: ISelectionData = {
        startLine: 50,
        startColumn: 0,
        endLine: 50,
        endColumn: 0,
    };

    suite("createErrorMessageNavigation", () => {
        test("uses the structured service selection without recalculating it", () => {
            const navigation = createErrorMessageNavigation(
                "Msg 102, Level 15, State 1, Line 51\nIncorrect syntax near ','.",
                errorSelection,
                "file:///q.sql",
            );

            expect(navigation).to.deep.equal({
                link: {
                    text: "Line 51",
                    uri: "file:///q.sql",
                },
                selection: errorSelection,
            });
        });

        test("does not parse localized server error text", () => {
            const navigation = createErrorMessageNavigation(
                "Mensaje 102, Nivel 15, Estado 1, Línea 51\nSintaxis incorrecta.",
                errorSelection,
                "file:///q.sql",
            );

            expect(navigation?.link.text).to.equal("Línea 51");
            expect(navigation?.selection).to.equal(errorSelection);
        });

        test("returns nothing without a message or service selection", () => {
            expect(createErrorMessageNavigation("Msg 102", undefined, "file:///q.sql")).to.be
                .undefined;
            expect(createErrorMessageNavigation(undefined, errorSelection, "file:///q.sql")).to.be
                .undefined;
        });
    });

    suite("splitMessages", () => {
        test("keeps navigation only on the linked display line", () => {
            const messages: qr.IMessage[] = [
                {
                    message: "Msg 102, Level 15, State 1, Line 51\nIncorrect syntax near ','.",
                    isError: true,
                    link: {
                        text: "Line 51",
                        uri: "file:///q.sql",
                    },
                    selection: errorSelection,
                },
            ];

            const split = splitMessages(messages);

            expect(split).to.have.lengthOf(2);
            expect(split[0].link?.text).to.equal("Line 51");
            expect(split[0].selection).to.equal(errorSelection);
            expect(split[1].link).to.be.undefined;
            expect(split[1].selection).to.be.undefined;
        });

        test("preserves an appended batch-start link", () => {
            const messages: qr.IMessage[] = [
                {
                    message: "Started executing query at ",
                    isError: false,
                    link: { text: "Line 5", uri: "file:///q.sql" },
                    selection: { ...errorSelection, startLine: 4, endLine: 4 },
                },
            ];

            const split = splitMessages(messages);

            expect(split).to.have.lengthOf(1);
            expect(split[0].link?.text).to.equal("Line 5");
        });

        test("still splits messages without navigation", () => {
            const split = splitMessages([{ message: "one\ntwo\nthree", isError: false }]);

            expect(split.map((message) => message.message)).to.deep.equal(["one", "two", "three"]);
        });

        test("returns an empty array for no messages", () => {
            expect(splitMessages([])).to.deep.equal([]);
            expect(splitMessages(undefined)).to.deep.equal([]);
            expect(splitMessages(null)).to.deep.equal([]);
        });
    });
});
