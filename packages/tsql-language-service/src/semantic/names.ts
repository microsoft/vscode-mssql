/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SemanticObjectIdentity, SemanticObjectKind } from "./contracts.js";

/** SQL Server identifiers compare case-insensitively for the common editor/catalog path. */
export function normalizeSemanticIdentifier(value: string): string {
    const trimmed = value.trim();
    const unquoted =
        (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
            ? trimmed.slice(1, -1)
            : trimmed;
    return unquoted.replaceAll("]]", "]").replaceAll('""', '"').toLocaleLowerCase("en-US");
}

export function displaySemanticIdentifier(value: string): string {
    const trimmed = value.trim();
    return (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
        ? trimmed.slice(1, -1).replaceAll("]]", "]").replaceAll('""', '"')
        : trimmed;
}

export function splitMultipartIdentifier(value: string): readonly string[] {
    const parts: string[] = [];
    let current = "";
    let quote: "bracket" | "double" | undefined;
    for (let index = 0; index < value.length; index++) {
        const char = value[index]!;
        if (quote === "bracket") {
            current += char;
            if (char === "]") {
                if (value[index + 1] === "]") {
                    current += value[++index]!;
                } else {
                    quote = undefined;
                }
            }
            continue;
        }
        if (quote === "double") {
            current += char;
            if (char === '"') {
                if (value[index + 1] === '"') {
                    current += value[++index]!;
                } else {
                    quote = undefined;
                }
            }
            continue;
        }
        if (char === "[") {
            quote = "bracket";
            current += char;
        } else if (char === '"') {
            quote = "double";
            current += char;
        } else if (char === ".") {
            if (current.trim()) {
                parts.push(displaySemanticIdentifier(current));
            }
            current = "";
        } else {
            current += char;
        }
    }
    if (current.trim()) {
        parts.push(displaySemanticIdentifier(current));
    }
    return parts;
}

export function semanticObjectIdentity(
    kind: SemanticObjectKind,
    parts: readonly string[],
): SemanticObjectIdentity {
    const normalized = parts.map(normalizeSemanticIdentifier);
    return Object.freeze({
        kind,
        parts: Object.freeze([...parts]),
        key: `${kind}:${normalized.join(".")}`,
    });
}

export function sameSemanticName(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    return left.every(
        (part, index) =>
            normalizeSemanticIdentifier(part) === normalizeSemanticIdentifier(right[index] ?? ""),
    );
}
