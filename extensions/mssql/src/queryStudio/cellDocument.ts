/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cell → document helpers for the qs/openCellDocument RPC (classic
 * openFileThroughLink parity): stringify one QsCellWindow cell value and
 * pretty-print it as XML or JSON before the host opens it in a side-by-side
 * text document. Malformed input falls back to the raw text — never throws.
 *
 * Format the original values without converting JSON numbers to JavaScript
 * numbers, and use an XML parser that understands attributes and CDATA.
 */

import { cellTextForPurpose } from "../sharedInterfaces/queryStudioGridOps";
import xmlFormatter = require("xml-formatter");

const XML_INDENT = "    ";
const XML_EOL = "\r\n";

/** Stringify one wire cell value (parity with the webview grid's cellText). */
export function cellDocumentText(value: unknown): string {
    if (value === undefined || value === null) {
        return "";
    }
    // Shared decode: typed wire wrappers (datetime2/binary/decimal/…) and
    // byte-capped markers render their VALUE, matching the grid exactly —
    // exports and cell documents must never leak the wire encoding. Typed
    // vector cells expand to their full JSON-array text (the grid shows only
    // a bounded preview; the opened document is the data-fidelity surface).
    return cellTextForPurpose(value, "cellDocument");
}

/** Pretty-print cell text for the opened document; raw text on parse failure. */
export function prettyPrintCellText(text: string, format: "xml" | "json"): string {
    if (format === "json") {
        try {
            // Validate grammar, but never serialize the parsed value: SQL
            // bigint/decimal values may exceed JavaScript number precision.
            JSON.parse(text);
            const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}\[\],:]|[^\s{}\[\],:]+/g) ?? [];
            let depth = 0;
            let output = "";
            const newline = () => "\n" + "  ".repeat(depth);
            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                if (token === "{" || token === "[") {
                    output += token;
                    depth++;
                    if (tokens[i + 1] !== "}" && tokens[i + 1] !== "]") {
                        output += newline();
                    }
                } else if (token === "}" || token === "]") {
                    depth--;
                    if (tokens[i - 1] !== "{" && tokens[i - 1] !== "[") {
                        output += newline();
                    }
                    output += token;
                } else if (token === ",") {
                    output += token + newline();
                } else {
                    output += token === ":" ? ": " : token;
                }
            }
            return output;
        } catch {
            return text;
        }
    }
    return indentXml(text);
}

/**
 * Keep text/CDATA inline so formatting does not insert whitespace into values.
 * The package exposes a callable CommonJS export and an ES-module default;
 * handle both the test build and the bundled extension.
 */
export function indentXml(xml: string): string {
    const format = (xmlFormatter.default ?? xmlFormatter) as typeof xmlFormatter.default;
    return format(xml, {
        indentation: XML_INDENT,
        lineSeparator: XML_EOL,
        collapseContent: true,
        strictMode: true,
        throwOnFailure: false,
    });
}
