/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Incremental decoders for tedious PLP/MAX chunks.
 *
 * Tedious 20 first retains every packet slice for a PLP cell and then uses
 * `Buffer.concat(chunks)` before decoding text. That contiguous buffer is a
 * second payload-sized external-memory representation. These helpers decode
 * the existing slices directly and preserve decoder state across odd UTF-16
 * and multibyte code-page boundaries.
 */

import * as iconv from "iconv-lite";
import { StringDecoder } from "string_decoder";

interface IncrementalDecoder {
    write(chunk: Buffer): string;
    end(): string | undefined;
}

function decodeChunks(chunks: readonly Buffer[], decoder: IncrementalDecoder): string {
    let value = "";
    for (const chunk of chunks) {
        value += decoder.write(chunk);
    }
    value += decoder.end() ?? "";
    return value;
}

/** Decode UTF-16LE PLP slices without allocating a contiguous Buffer. */
export function decodeUtf16LeChunks(chunks: readonly Buffer[]): string {
    return decodeChunks(chunks, new StringDecoder("utf16le"));
}

/** Decode varchar(max) PLP slices with the column collation's code page. */
export function decodeCodePageChunks(chunks: readonly Buffer[], encoding: string): string {
    return decodeChunks(chunks, iconv.getDecoder(encoding));
}
