/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as iconv from "iconv-lite";
import * as path from "path";
import {
    decodeCodePageChunks,
    decodeUtf16LeChunks,
} from "../../../src/services/tsNative/driver/plpChunkDecoder";

function splitEveryByte(value: Buffer): Buffer[] {
    return Array.from(value, (_byte, index) => value.subarray(index, index + 1));
}

suite("ts-native incremental PLP text decode", () => {
    test("UTF-16LE preserves characters across every odd byte boundary", () => {
        const expected = "plain Ω astral 😀 end";
        const encoded = Buffer.from(expected, "utf16le");
        expect(decodeUtf16LeChunks(splitEveryByte(encoded))).to.equal(expected);
    });

    test("UTF-16LE matches contiguous decode for arbitrary packet slices", () => {
        const encoded = Buffer.from("alpha βeta 😀 omega", "utf16le");
        const chunks = [encoded.subarray(0, 3), encoded.subarray(3, 17), encoded.subarray(17)];
        expect(decodeUtf16LeChunks(chunks)).to.equal(encoded.toString("utf16le"));
        expect(decodeUtf16LeChunks([])).to.equal("");
    });

    test("code-page decoder preserves multibyte and legacy boundaries", () => {
        const utf8 = iconv.encode("café 😀", "utf8");
        expect(decodeCodePageChunks(splitEveryByte(utf8), "utf8")).to.equal("café 😀");

        const windows = iconv.encode("café €", "windows-1252");
        expect(decodeCodePageChunks(splitEveryByte(windows), "windows-1252")).to.equal("café €");
    });

    test("pinned tedious row parser removes only the text concat seams", () => {
        // Runtime path is out/test/unit/tsNative; the build script intentionally
        // stays outside TypeScript emission.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const plugin = require(
            path.resolve(__dirname, "../../../../scripts/tedious-streaming-plp-decode-plugin.js"),
        ) as {
            rewriteTediousRowParser(source: string, helperPath: string): string;
        };
        const parserPath = require.resolve("tedious/lib/token/row-token-parser.js");
        const rewritten = plugin.rewriteTediousRowParser(
            fs.readFileSync(parserPath, "utf8"),
            "C:/tested/plpChunkDecoder.ts",
        );
        expect(rewritten).to.contain("decodeUtf16LeChunks(chunks)");
        expect(rewritten).to.contain("decodeCodePageChunks(chunks");
        expect(rewritten).to.not.contain("Buffer.concat(chunks).toString('ucs2')");
        // Binary/UDT must remain a Buffer; only text avoids the second image.
        expect(rewritten).to.contain("value: Buffer.concat(chunks)");
    });
});
