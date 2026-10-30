/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { createHash } from "crypto";
import { TdsColumn } from "../../../src/services/tsNative/driver/tdsDriver";
import {
    encodeCell,
    EncodePolicy,
    utf8SafePrefix,
} from "../../../src/services/tsNative/cellEncoder";

const POLICY: EncodePolicy = {
    maxCellBytes: 8,
    truncatedPrefixBytes: 5,
    lossyPreview: false,
    spatialWkb: false,
    vectorBinary: false,
};
const NVARCHAR: TdsColumn = { name: "payload", typeName: "nvarchar" };

suite("ts-native bounded string cell encoding", () => {
    test("returns a UTF-8-safe prefix without materializing the complete byte buffer", () => {
        // a (1) + emoji (4) + b (1): a 4-byte cap must retain only `a`.
        expect(utf8SafePrefix("a😀b", 4, 6)).to.equal("a");
        expect(utf8SafePrefix("a😀b", 5, 6)).to.equal("a😀");
        expect(utf8SafePrefix("éz", 2, 3)).to.equal("é");
    });

    test("matches Buffer UTF-8 replacement behavior for lone surrogates", () => {
        const source = `a\ud800b`;
        const expected = Buffer.from(source, "utf8").subarray(0, 4).toString("utf8");
        expect(utf8SafePrefix(source, 4, Buffer.byteLength(source, "utf8"))).to.equal(expected);
    });

    test("keeps original byte count, digest, and bounded prefix facts", () => {
        const raw = "abcdef😀";
        const encoded = encodeCell({ value: raw }, NVARCHAR, POLICY);
        expect(encoded.isNull).to.equal(false);
        expect(encoded.value).to.deep.equal({
            $t: "truncated",
            of: "string",
            bytes: Buffer.byteLength(raw, "utf8"),
            digest: `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`,
            v: "abcde",
        });
    });

    test("retains only a detached bounded prefix for a MAX string", () => {
        const raw = "x".repeat(1024 * 1024);
        const encoded = encodeCell({ value: raw }, NVARCHAR, POLICY);
        expect(encoded.value).to.include({
            $t: "truncated",
            of: "string",
            bytes: 1024 * 1024,
            v: "xxxxx",
        });
        // The contract stays bounded even when the driver materializes a
        // multi-megabyte source string. The encoder copies only this prefix.
        expect(Buffer.byteLength((encoded.value as { v: string }).v, "utf8")).to.equal(5);
    });
});
