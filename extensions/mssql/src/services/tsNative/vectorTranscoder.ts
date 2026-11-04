/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQL Server vector text → typed f32le cell transcoder (TSQ2 §6.8, D-0019
 * parity). Engaged ONLY for columns whose driver metadata says
 * typeName === "vector" — NEVER inferred from a varchar that looks like
 * "[1,2,3]" (addendum §6.8 explicit rule). On today's tedious/TDS 7.4 the
 * server down-converts vector to identity-less varchar (empirically
 * verified), so `types.vectorBinaryV1` stays unadvertised; the path exists,
 * is fake-driver tested, and lights up when a driver exposes the identity.
 *
 * Text format observed live: scientific notation JSON-ish array —
 * "[1.5000000e+000,2.5000000e+000]". Parsing is strict: bracketed, comma
 * separated, finite floats only; anything else is a per-cell `unavailable`
 * status (vectors are never truncated — STS2 rule).
 */

import { VECTOR_MAX_DIMENSIONS } from "../../sharedInterfaces/queryResultCellCodec";

export interface VectorTranscodeOk {
    status: "ok";
    dimensions: number;
    /** Little-endian IEEE-754 float32, one per dimension. */
    data: Buffer;
}

export interface VectorTranscodeUnavailable {
    status: "unavailable";
    reason: "decodeFailed" | "unsupportedBaseType" | "cellLimit";
}

export type VectorTranscodeResult = VectorTranscodeOk | VectorTranscodeUnavailable;

export function transcodeVectorText(text: string): VectorTranscodeResult {
    const trimmed = text.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
        return { status: "unavailable", reason: "decodeFailed" };
    }
    const body = trimmed.slice(1, -1).trim();
    if (body.length === 0) {
        return { status: "unavailable", reason: "decodeFailed" };
    }
    const parts = body.split(",");
    if (parts.length > VECTOR_MAX_DIMENSIONS) {
        return { status: "unavailable", reason: "cellLimit" };
    }
    const data = Buffer.allocUnsafe(parts.length * 4);
    for (let i = 0; i < parts.length; i++) {
        const value = Number(parts[i]);
        if (!Number.isFinite(value)) {
            return { status: "unavailable", reason: "decodeFailed" };
        }
        data.writeFloatLE(Math.fround(value), i * 4);
    }
    return { status: "ok", dimensions: parts.length, data };
}
