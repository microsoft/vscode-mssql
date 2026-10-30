/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pinned build-time repair for tedious 20's text PLP decoder.
 *
 * Only the lazy tsNativeProvider bundle contains tedious. The upstream row
 * parser materializes text MAX values as packet slices plus a second
 * `Buffer.concat` allocation. Rewriting the two exact expressions keeps the
 * package's public API and protocol parser intact while routing text decode
 * through our tested incremental helper. Exact source checks deliberately
 * fail the build when a tedious upgrade changes this ownership boundary.
 */

const fs = require("fs").promises;
const path = require("path");

const PINNED_TEDIOUS_VERSION = "20.0.0";
const UNICODE_EXPRESSION = "Buffer.concat(chunks).toString('ucs2')";
const CODEPAGE_EXPRESSION =
    "iconv.decode(Buffer.concat(chunks), metadata.collation?.codepage ?? 'utf8')";

function replaceExactlyOnce(source, search, replacement, label) {
    const first = source.indexOf(search);
    const last = source.lastIndexOf(search);
    if (first < 0 || first !== last) {
        throw new Error(
            `tedious ${PINNED_TEDIOUS_VERSION} ${label} ownership seam changed; expected exactly one '${search}'`,
        );
    }
    return source.replace(search, replacement);
}

function rewriteTediousRowParser(source, helperPath) {
    let rewritten = replaceExactlyOnce(
        source,
        UNICODE_EXPRESSION,
        "decodeUtf16LeChunks(chunks)",
        "Unicode PLP decoder",
    );
    rewritten = replaceExactlyOnce(
        rewritten,
        CODEPAGE_EXPRESSION,
        "decodeCodePageChunks(chunks, metadata.collation?.codepage ?? 'utf8')",
        "code-page PLP decoder",
    );
    const importLine = `const { decodeUtf16LeChunks, decodeCodePageChunks } = require(${JSON.stringify(helperPath)});\n`;
    return rewritten.replace('"use strict";\n', `"use strict";\n${importLine}`);
}

function tediousStreamingPlpDecodePlugin() {
    const packageJson = require.resolve("tedious/package.json", { paths: [process.cwd()] });
    const version = require(packageJson).version;
    if (version !== PINNED_TEDIOUS_VERSION) {
        throw new Error(
            `streaming PLP decoder is pinned to tedious ${PINNED_TEDIOUS_VERSION}; found ${version}`,
        );
    }
    const helperPath = path.resolve(
        process.cwd(),
        "src/services/tsNative/driver/plpChunkDecoder.ts",
    );
    return {
        name: "tedious-streaming-plp-decode",
        setup(build) {
            build.onLoad(
                { filter: /[\\/]tedious[\\/]lib[\\/]token[\\/]row-token-parser\.js$/ },
                async (args) => ({
                    contents: rewriteTediousRowParser(
                        await fs.readFile(args.path, "utf8"),
                        helperPath,
                    ),
                    loader: "js",
                    resolveDir: path.dirname(args.path),
                }),
            );
        },
    };
}

module.exports = {
    PINNED_TEDIOUS_VERSION,
    rewriteTediousRowParser,
    tediousStreamingPlpDecodePlugin,
};
