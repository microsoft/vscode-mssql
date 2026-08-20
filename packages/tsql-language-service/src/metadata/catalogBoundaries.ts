/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    ObjectMetadata,
    PrincipalMetadata,
    SqlObjectKind,
    SqlPrincipalKind,
} from "./contracts.js";

export type SqlObjectCapability = "columns" | "parameters";

/**
 * One authoritative description of the `sys.objects.type` values consumed by the language
 * service. Query builders and row decoders share this registry so adding a kind cannot make
 * identity loading disagree with detail hydration.
 */
export interface SqlObjectTypeDescriptor {
    readonly code: string;
    readonly kind: SqlObjectKind;
    readonly columns: boolean;
    readonly parameters: boolean;
}

export const sqlObjectTypeDescriptors: readonly SqlObjectTypeDescriptor[] = Object.freeze([
    { code: "U", kind: "table", columns: true, parameters: false },
    { code: "V", kind: "view", columns: true, parameters: false },
    { code: "P", kind: "procedure", columns: false, parameters: true },
    { code: "PC", kind: "procedure", columns: false, parameters: true },
    { code: "FN", kind: "scalarFunction", columns: false, parameters: true },
    { code: "FS", kind: "scalarFunction", columns: false, parameters: true },
    { code: "IF", kind: "tableFunction", columns: true, parameters: true },
    { code: "TF", kind: "tableFunction", columns: true, parameters: true },
    { code: "FT", kind: "tableFunction", columns: true, parameters: true },
    { code: "SN", kind: "synonym", columns: false, parameters: false },
]);

const objectKindsByCode = new Map(
    sqlObjectTypeDescriptors.map((descriptor) => [descriptor.code, descriptor.kind] as const),
);

export function decodeSqlObjectKind(value: string | undefined): SqlObjectKind | undefined {
    return value === undefined ? undefined : objectKindsByCode.get(value.trim().toUpperCase());
}

export function sqlObjectTypeCodes(capability?: SqlObjectCapability): readonly string[] {
    return sqlObjectTypeDescriptors
        .filter((descriptor) => capability === undefined || descriptor[capability])
        .map((descriptor) => descriptor.code);
}

const typeCategories = new Map<string, NonNullable<ObjectMetadata["typeCategory"]>>([
    ["alias", "alias"],
    ["clr", "clr"],
    ["table", "table"],
]);

export function decodeObjectTypeCategory(
    value: string | undefined,
): ObjectMetadata["typeCategory"] {
    return value === undefined ? undefined : typeCategories.get(value.trim().toLowerCase());
}

const principalKinds = new Map<string, SqlPrincipalKind>(
    (
        [
            "login",
            "user",
            "databaseRole",
            "serverRole",
            "applicationRole",
        ] as const satisfies readonly PrincipalMetadata["kind"][]
    ).map((kind) => [kind.toLowerCase(), kind]),
);

export function decodePrincipalKind(value: string | undefined): SqlPrincipalKind | undefined {
    return value === undefined ? undefined : principalKinds.get(value.trim().toLowerCase());
}

/** Decodes a SQL `bit` without turning an unknown backend representation into false. */
export function decodeSqlBit(value: string | undefined): boolean | undefined {
    switch (value?.trim().toLowerCase()) {
        case "1":
        case "true":
            return true;
        case "0":
        case "false":
            return false;
        default:
            return undefined;
    }
}

/** Decodes a SQL `int` only when its exact decimal spelling and range are valid. */
export function decodeSqlInt32(value: string | undefined): number | undefined {
    const trimmed = value?.trim();
    if (!trimmed || !/^-?\d+$/.test(trimmed)) return undefined;
    const decoded = Number(trimmed);
    if (!Number.isSafeInteger(decoded) || decoded < -2_147_483_648 || decoded > 2_147_483_647) {
        return undefined;
    }
    return decoded;
}
