/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { assertDefined } from "../support/assertions.ts";

export type CorpusEncoding = "utf8" | "utf8-bom" | "utf16le" | "utf16be";

export interface CorpusFile {
    readonly path: string;
    readonly bytes: number;
    readonly encoding: CorpusEncoding;
    readonly expectation: "parseable" | "recovery";
}

export interface CorpusManifest {
    readonly files: readonly CorpusFile[];
}

export interface CorpusBaseline {
    readonly rawErrors: number;
    readonly files: Readonly<Record<string, number>>;
}

export const corpusRoot = path.join(__dirname, "..", "..", "resources", "corpus");

export async function readCorpusManifest(): Promise<CorpusManifest> {
    const value: unknown = JSON.parse(
        await readFile(path.join(corpusRoot, "manifest.json"), "utf8"),
    );
    assertCorpusManifest(value);
    return value;
}

export async function readCorpusBaseline(): Promise<CorpusBaseline> {
    const value: unknown = JSON.parse(
        await readFile(path.join(corpusRoot, "baseline.json"), "utf8"),
    );
    assertCorpusBaseline(value);
    return value;
}

export function decodeCorpusFile(bytes: Buffer, encoding: CorpusEncoding): string {
    if (encoding === "utf16le") return bytes.subarray(2).toString("utf16le");
    if (encoding === "utf16be") {
        const body = Buffer.from(bytes.subarray(2));
        for (let index = 0; index + 1 < body.length; index += 2) {
            const first = body[index];
            const second = body[index + 1];
            assertDefined(first, "expected the first UTF-16BE byte");
            assertDefined(second, "expected the second UTF-16BE byte");
            body[index] = second;
            body[index + 1] = first;
        }
        return body.toString("utf16le");
    }
    if (encoding === "utf8-bom") return bytes.subarray(3).toString("utf8");
    return bytes.toString("utf8");
}

function assertCorpusManifest(value: unknown): asserts value is CorpusManifest {
    assert.ok(isRecord(value), "expected a corpus manifest object");
    assert.ok(Array.isArray(value.files), "expected a corpus file inventory");
    for (const file of value.files) {
        assert.ok(isRecord(file), "expected corpus file metadata");
        assert.equal(typeof file.path, "string");
        assert.equal(typeof file.bytes, "number");
        assert.ok(
            file.encoding === "utf8" ||
                file.encoding === "utf8-bom" ||
                file.encoding === "utf16le" ||
                file.encoding === "utf16be",
            "expected a supported corpus encoding",
        );
        assert.ok(file.expectation === "parseable" || file.expectation === "recovery");
    }
}

function assertCorpusBaseline(value: unknown): asserts value is CorpusBaseline {
    assert.ok(isRecord(value), "expected a corpus baseline object");
    assert.equal(typeof value.rawErrors, "number");
    assert.ok(isRecord(value.files), "expected corpus baseline file counts");
    for (const [file, rawErrors] of Object.entries(value.files)) {
        assert.equal(typeof rawErrors, "number", `${file}: expected a numeric baseline`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
