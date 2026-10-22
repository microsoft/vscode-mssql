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
 * XML uses a minimal local indenter instead of the shared formatXml: that
 * helper's `import xmlFormatter from "xml-formatter"` default-import only
 * survives the esbuild bundle — under the tsc CommonJS build (vscode-test)
 * it resolves to undefined and formatXml silently returns raw text.
 */

import { cellTextForPurpose } from "../sharedInterfaces/queryStudioGridOps";

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
            return JSON.stringify(JSON.parse(text), undefined, 2);
        } catch {
            return text;
        }
    }
    return indentXml(text);
}

/**
 * Minimal XML indenter (4-space indent, CRLF — classic formatXml's defaults).
 * One tag or text run per line; mismatched/unclosed tags return the input
 * unchanged so malformed cells open as-is.
 */
export function indentXml(xml: string): string {
    const trimmed = xml.trim();
    if (!(trimmed.startsWith("<") && trimmed.endsWith(">"))) {
        return xml;
    }
    const tokens = trimmed.match(/<[^>]*>|[^<]+/g);
    if (!tokens) {
        return xml;
    }
    const lines: string[] = [];
    const stack: string[] = [];
    for (const token of tokens) {
        if (token.startsWith("</")) {
            if (stack.length === 0 || stack[stack.length - 1] !== tagName(token)) {
                return xml; // mismatched close — leave malformed input raw
            }
            stack.pop();
            lines.push(XML_INDENT.repeat(stack.length) + token);
        } else if (token.startsWith("<")) {
            lines.push(XML_INDENT.repeat(stack.length) + token);
            const selfContained =
                token.endsWith("/>") || // self-closing element
                token.startsWith("<?") || // processing instruction / declaration
                token.startsWith("<!"); // comment / doctype / CDATA
            if (!selfContained) {
                stack.push(tagName(token));
            }
        } else {
            const text = token.trim();
            if (text.length > 0) {
                lines.push(XML_INDENT.repeat(stack.length) + text);
            }
        }
    }
    if (stack.length > 0) {
        return xml; // unclosed tags — leave malformed input raw
    }
    return lines.join(XML_EOL);
}

function tagName(tag: string): string {
    return /^<\/?\s*([^\s/>]+)/.exec(tag)?.[1] ?? "";
}
