/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * qs/openCellDocument helpers (classic openFileThroughLink parity): cell
 * value stringification, XML indentation golden, JSON pretty-print, and the
 * malformed-input → raw-text fallbacks.
 */

import { expect } from "chai";
import {
    cellDocumentText,
    indentXml,
    prettyPrintCellText,
} from "../../src/queryStudio/cellDocument";

suite("Query Studio cell document", () => {
    suite("cellDocumentText", () => {
        test("strings and scalars pass through as text", () => {
            expect(cellDocumentText("<a/>")).to.equal("<a/>");
            expect(cellDocumentText(42)).to.equal("42");
            // bit renders 0/1 (SSMS parity via the shared decode)
            expect(cellDocumentText(true)).to.equal("1");
        });

        test("object cell values stringify like the webview's cellText", () => {
            expect(cellDocumentText({ a: 1 })).to.equal('{"a":1}');
            expect(cellDocumentText([1, 2])).to.equal("[1,2]");
        });

        test("null and undefined become empty text (never links upstream)", () => {
            expect(cellDocumentText(null)).to.equal("");
            expect(cellDocumentText(undefined)).to.equal("");
        });

        test("typed wire wrappers decode to their value (grid parity, no wire JSON)", () => {
            expect(
                cellDocumentText({ $t: "datetime2", v: "2003-04-08T09:13:36.3900000" }),
            ).to.equal("2003-04-08 09:13:36.390");
            expect(cellDocumentText({ $t: "binary", v: "AAEC" })).to.equal("0x000102");
            expect(cellDocumentText({ $t: "decimal", v: "1.50" })).to.equal("1.50");
            expect(cellDocumentText({ $t: "truncated", of: "string", v: "prefix" })).to.equal(
                "prefix",
            );
        });
    });

    suite("prettyPrintCellText", () => {
        test("XML indentation golden (classic formatXml layout)", () => {
            expect(prettyPrintCellText("<a><b>1</b><c/></a>", "xml")).to.equal(
                "<a>\r\n    <b>1</b>\r\n    <c/>\r\n</a>",
            );
        });

        test("XML declaration and attributes keep their own lines", () => {
            expect(indentXml('<?xml version="1.0"?><r a="1"><v/></r>')).to.equal(
                '<?xml version="1.0"?>\r\n<r a="1">\r\n    <v/>\r\n</r>',
            );
        });

        test("malformed XML falls back to the raw text", () => {
            expect(prettyPrintCellText("hello world", "xml")).to.equal("hello world");
            expect(prettyPrintCellText("<a><b>", "xml")).to.equal("<a><b>");
            expect(prettyPrintCellText("<a></b>", "xml")).to.equal("<a></b>");
        });

        test("XML preserves CDATA, quoted delimiters, comments and mixed text", () => {
            for (const value of [
                "<r><![CDATA[x>y <z>]]></r>",
                '<r a="x>y"><v/></r>',
                '<r a="x>y"><!-- x>y --><v/></r>',
                "<r>hello <b>world</b> !</r>",
                '<r xml:space="preserve">  x\n y  </r>',
            ]) {
                const formatted = indentXml(value);
                // XML normalizes line endings; indentation must preserve the
                // parsed payload, including whitespace marked for preservation.
                expect(formatted.replace(/>\r\n\s*</g, "><").replace(/\r\n/g, "\n")).to.equal(
                    value,
                );
            }
        });

        test("JSON formatting preserves numeric and string lexemes", () => {
            const value =
                '{"big":9223372036854775807,"decimal":1.230000000000000001,"exp":1e400,"negative":-0,"s":"a\\n\\\"b","empty":[]}';
            expect(prettyPrintCellText(value, "json")).to.equal(
                '{\n  "big": 9223372036854775807,\n  "decimal": 1.230000000000000001,\n  "exp": 1e400,\n  "negative": -0,\n  "s": "a\\n\\\"b",\n  "empty": []\n}',
            );
        });

        test("JSON pretty-prints with 2-space indentation", () => {
            expect(prettyPrintCellText('{"a":1,"b":[1,2]}', "json")).to.equal(
                '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}',
            );
        });

        test("malformed JSON falls back to the raw text", () => {
            expect(prettyPrintCellText("{not json", "json")).to.equal("{not json");
        });
    });
});
