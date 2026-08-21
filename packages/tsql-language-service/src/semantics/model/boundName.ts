/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MetadataView } from "../../metadata/index.js";
import type { SyntaxNode, SyntaxSnapshot } from "../../syntax/index.js";
import { firstDescendantOfKind } from "../../syntax/treeUtilities.js";
import { formatMultipartName, parseMultipartName } from "../identifiers.js";
import { normalizeIdentifier } from "../identifiers.js";
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
    resolutionParts?: readonly string[],
): BoundName {
    const parsed = parseMultipartName(written, node.start);
    const normalized = parsed.parts.map((part) => part.normalized);
    const object = normalized.at(-1) ?? "";
    const schema = normalized.at(-2) ?? metadata.environment.defaultSchema;
    const resolved = resolutionParts ?? normalized;
    const database = resolved.at(-3) ?? metadata.environment.currentDatabase;
    return Object.freeze({
        parts: parsed.parts,
        range: { start: node.start, end: node.end },
        role,
        ...(database === undefined ? {} : { database }),
        ...(schema === undefined ? {} : { schema }),
        object,
        hasOmittedParts: parsed.hasOmittedParts,
        resolution: resolutionFor(metadata, resolved, target),
        insertionForm: formatMultipartName(normalized),
    }) as BoundName;
}

/** Applies the most recent preceding USE statement to a one- or two-part catalog name. */
export function catalogPartsAt(
    metadata: MetadataView,
    syntax: SyntaxSnapshot,
    useStatements: readonly SyntaxNode[],
    parts: readonly string[],
    offset: number,
): readonly string[] {
    if (parts.length >= 3 || parts.length === 0) return parts;
    let database = metadata.environment.currentDatabase;
    for (const statement of useStatements) {
        if (statement.end > offset) break;
        const name = firstDescendantOfKind(statement, "IdentifierName");
        if (name) {
            database = normalizeIdentifier(syntax.document.text.slice(name.start, name.end));
        }
    }
    if (!database) return parts;
    if (parts.length === 2) return [database, ...parts];
    const schema = metadata.environment.defaultSchema;
    return schema ? [database, schema, ...parts] : parts;
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
