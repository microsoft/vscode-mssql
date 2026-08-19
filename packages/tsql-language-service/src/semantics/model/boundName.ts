/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MetadataView } from "../../metadata/index.js";
import type { SyntaxNode } from "../../syntax/index.js";
import { formatMultipartName, parseMultipartName } from "../identifiers.js";
import type { BoundName, BoundNameRole, CallTarget, NameResolution } from "./contracts.js";

/**
 * One name occurrence, bound once.
 *
 * Diagnostics, hover, definition, coloring, references, and completion insertion all read the same
 * value, so a four-part name, a bracketed name, and an omitted-component name cannot mean one
 * thing in a squiggle and another in a tooltip.
 */
export function boundNameFrom(
    metadata: MetadataView,
    node: SyntaxNode,
    written: string,
    role: BoundNameRole,
    target?: CallTarget,
): BoundName {
    const parsed = parseMultipartName(written, node.start);
    const normalized = parsed.parts.map((part) => part.normalized);
    const object = normalized.at(-1) ?? "";
    const schema = normalized.at(-2) ?? metadata.environment.defaultSchema;
    const database = normalized.at(-3) ?? metadata.environment.currentDatabase;
    return Object.freeze({
        parts: parsed.parts,
        range: { start: node.start, end: node.end },
        role,
        ...(database === undefined ? {} : { database }),
        ...(schema === undefined ? {} : { schema }),
        object,
        hasOmittedParts: parsed.hasOmittedParts,
        resolution: resolutionFor(metadata, normalized, target),
        insertionForm: formatMultipartName(normalized),
    }) as BoundName;
}

function resolutionFor(
    metadata: MetadataView,
    parts: readonly string[],
    target?: CallTarget,
): NameResolution {
    if (target) {
        switch (target.kind) {
            case "catalog":
                return { kind: "catalog", object: target.object, objectKind: target.objectKind };
            case "local":
                return { kind: "local", symbol: target.symbol, objectKind: target.objectKind };
            case "builtin":
            case "operator":
                return { kind: "unresolved", reason: "unknown" };
            case "unresolved":
                break;
        }
    }
    const resolution = metadata.resolveObject(parts);
    switch (resolution.kind) {
        case "resolved":
            return {
                kind: "catalog",
                object: resolution.object.ref,
                objectKind: resolution.object.kind,
            };
        case "ambiguous":
            return {
                kind: "ambiguous",
                candidates: Object.freeze(resolution.candidates.map((candidate) => candidate.ref)),
            };
        case "notFound":
            return { kind: "unresolved", reason: "notFound" };
        default:
            // Loading, unavailable, and stale metadata are all "not yet known". Reporting them as
            // absence is what turns a still-connecting catalog into a screen of false errors.
            return { kind: "unresolved", reason: "unknown" };
    }
}
