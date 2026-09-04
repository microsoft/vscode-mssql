/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Structured OE v2 paths (oe_view_design §9.3): every tree node's identity
 * is a typed value, encoded to a versioned string ONLY at the tree edge.
 * Segments are percent-encoded so hostile identifiers ([, ], |, /, %, …)
 * round-trip. Full path strings are never logged — log path KIND only.
 */

/**
 * Folder segments are hierarchy-registry ids (oeV2Hierarchy.ts), open-ended
 * by design: layout growth (B23+ "security", "serverObjects", nested ids
 * like "security/logins") must never require a codec change. Unknown ids
 * decode fine and surface as stale-path errors at browse time.
 */
export type OeV2ServerFolder = string;

export type OeV2DatabaseFolder = string;

export type OeV2ObjectFolder = "columns" | "keys" | "foreignKeys" | "parameters";

export type OeV2ObjectKind =
    | "table"
    | "view"
    | "procedure"
    | "scalarFunction"
    | "tableFunction"
    | "synonym";

export type OeV2Path =
    | { kind: "root" }
    | { kind: "connectionGroup"; groupId: string }
    | { kind: "connection"; connectionId: string }
    | { kind: "serverFolder"; connectionId: string; folder: OeV2ServerFolder }
    | { kind: "serverObjectItem"; connectionId: string; folder: OeV2ServerFolder; name: string }
    | {
          kind: "databaseObjectItem";
          connectionId: string;
          database: string;
          folder: OeV2DatabaseFolder;
          name: string;
      }
    | { kind: "database"; connectionId: string; database: string }
    | {
          kind: "databaseFolder";
          connectionId: string;
          database: string;
          folder: OeV2DatabaseFolder;
      }
    | { kind: "schema"; connectionId: string; database: string; schema: string }
    | {
          kind: "schemaFolder";
          connectionId: string;
          database: string;
          schema: string;
          folder: OeV2DatabaseFolder;
      }
    | {
          kind: "object";
          connectionId: string;
          database: string;
          schema: string;
          name: string;
          objectKind: OeV2ObjectKind;
      }
    | {
          kind: "objectFolder";
          connectionId: string;
          database: string;
          schema: string;
          name: string;
          objectKind: OeV2ObjectKind;
          folder: OeV2ObjectFolder;
      }
    | {
          kind: "column";
          connectionId: string;
          database: string;
          schema: string;
          objectName: string;
          column: string;
      }
    | {
          kind: "parameter";
          connectionId: string;
          database: string;
          schema: string;
          objectName: string;
          parameter: string;
          ordinal: number;
      }
    | { kind: "status"; scope: string; connectionId?: string }
    | { kind: "error"; scope: string; connectionId?: string; code?: string };

const VERSION = "oe2:";
const OBJECT_KINDS = new Set<OeV2ObjectKind>([
    "table",
    "view",
    "procedure",
    "scalarFunction",
    "tableFunction",
    "synonym",
]);
const OBJECT_FOLDERS = new Set<OeV2ObjectFolder>(["columns", "keys", "foreignKeys", "parameters"]);

const enc = (segment: string): string => encodeURIComponent(segment);
const dec = (segment: string): string => decodeURIComponent(segment);

/** Deterministic, versioned string id for a structured path. */
export function encodePath(path: OeV2Path): string {
    const parts: string[] = [path.kind];
    switch (path.kind) {
        case "root":
            break;
        case "connectionGroup":
            parts.push(enc(path.groupId));
            break;
        case "connection":
            parts.push(enc(path.connectionId));
            break;
        case "serverFolder":
            parts.push(enc(path.connectionId), enc(path.folder));
            break;
        case "serverObjectItem":
            parts.push(enc(path.connectionId), enc(path.folder), enc(path.name));
            break;
        case "databaseObjectItem":
            parts.push(
                enc(path.connectionId),
                enc(path.database),
                enc(path.folder),
                enc(path.name),
            );
            break;
        case "database":
            parts.push(enc(path.connectionId), enc(path.database));
            break;
        case "databaseFolder":
            parts.push(enc(path.connectionId), enc(path.database), enc(path.folder));
            break;
        case "schema":
            parts.push(enc(path.connectionId), enc(path.database), enc(path.schema));
            break;
        case "schemaFolder":
            parts.push(
                enc(path.connectionId),
                enc(path.database),
                enc(path.schema),
                enc(path.folder),
            );
            break;
        case "object":
            parts.push(
                enc(path.connectionId),
                enc(path.database),
                enc(path.schema),
                enc(path.name),
                path.objectKind,
            );
            break;
        case "objectFolder":
            parts.push(
                enc(path.connectionId),
                enc(path.database),
                enc(path.schema),
                enc(path.name),
                path.objectKind,
                path.folder,
            );
            break;
        case "column":
            parts.push(
                enc(path.connectionId),
                enc(path.database),
                enc(path.schema),
                enc(path.objectName),
                enc(path.column),
            );
            break;
        case "parameter":
            parts.push(
                enc(path.connectionId),
                enc(path.database),
                enc(path.schema),
                enc(path.objectName),
                enc(path.parameter),
                String(path.ordinal),
            );
            break;
        case "status":
            parts.push(enc(path.scope), enc(path.connectionId ?? ""));
            break;
        case "error":
            parts.push(enc(path.scope), enc(path.connectionId ?? ""), enc(path.code ?? ""));
            break;
    }
    return VERSION + parts.join("/");
}

/** Decode a versioned path id; undefined for foreign/corrupt ids. */
export function decodePath(id: string): OeV2Path | undefined {
    if (!id.startsWith(VERSION)) {
        return undefined;
    }
    const parts = id.slice(VERSION.length).split("/");
    const kind = parts[0];
    try {
        const requireLength = (expected: number): void => {
            if (parts.length !== expected) {
                throw new Error("malformed OE v2 path");
            }
        };
        switch (kind) {
            case "root":
                requireLength(1);
                return { kind: "root" };
            case "connectionGroup":
                requireLength(2);
                return { kind, groupId: dec(parts[1]) };
            case "connection":
                requireLength(2);
                return { kind, connectionId: dec(parts[1]) };
            case "serverFolder":
                requireLength(3);
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    folder: dec(parts[2]),
                };
            case "serverObjectItem":
                requireLength(4);
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    folder: dec(parts[2]),
                    name: dec(parts[3]),
                };
            case "databaseObjectItem":
                requireLength(5);
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    database: dec(parts[2]),
                    folder: dec(parts[3]),
                    name: dec(parts[4]),
                };
            case "database":
                requireLength(3);
                return { kind, connectionId: dec(parts[1]), database: dec(parts[2]) };
            case "databaseFolder":
                requireLength(4);
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    database: dec(parts[2]),
                    folder: dec(parts[3]),
                };
            case "schema":
                requireLength(4);
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    database: dec(parts[2]),
                    schema: dec(parts[3]),
                };
            case "schemaFolder":
                requireLength(5);
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    database: dec(parts[2]),
                    schema: dec(parts[3]),
                    folder: dec(parts[4]),
                };
            case "object": {
                requireLength(6);
                const objectKind = parts[5] as OeV2ObjectKind;
                if (!OBJECT_KINDS.has(objectKind)) {
                    return undefined;
                }
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    database: dec(parts[2]),
                    schema: dec(parts[3]),
                    name: dec(parts[4]),
                    objectKind,
                };
            }
            case "objectFolder": {
                requireLength(7);
                const objectKind = parts[5] as OeV2ObjectKind;
                const folder = parts[6] as OeV2ObjectFolder;
                if (!OBJECT_KINDS.has(objectKind) || !OBJECT_FOLDERS.has(folder)) {
                    return undefined;
                }
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    database: dec(parts[2]),
                    schema: dec(parts[3]),
                    name: dec(parts[4]),
                    objectKind,
                    folder,
                };
            }
            case "column":
                requireLength(6);
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    database: dec(parts[2]),
                    schema: dec(parts[3]),
                    objectName: dec(parts[4]),
                    column: dec(parts[5]),
                };
            case "parameter": {
                requireLength(7);
                const ordinal = Number(parts[6]);
                if (!Number.isInteger(ordinal)) {
                    return undefined;
                }
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    database: dec(parts[2]),
                    schema: dec(parts[3]),
                    objectName: dec(parts[4]),
                    parameter: dec(parts[5]),
                    ordinal,
                };
            }
            case "status": {
                requireLength(3);
                const connectionId = dec(parts[2] ?? "");
                return {
                    kind,
                    scope: dec(parts[1]),
                    ...(connectionId ? { connectionId } : {}),
                };
            }
            case "error": {
                requireLength(4);
                const connectionId = dec(parts[2] ?? "");
                const code = dec(parts[3] ?? "");
                return {
                    kind,
                    scope: dec(parts[1]),
                    ...(connectionId ? { connectionId } : {}),
                    ...(code ? { code } : {}),
                };
            }
            default:
                return undefined;
        }
    } catch {
        return undefined; // malformed percent-encoding
    }
}
