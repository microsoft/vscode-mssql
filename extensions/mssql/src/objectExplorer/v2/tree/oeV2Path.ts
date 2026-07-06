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

export type OeV2ServerFolder = "databases" | "security" | "serverObjects";

export type OeV2DatabaseFolder =
    | "tables"
    | "views"
    | "storedProcedures"
    | "functions"
    | "synonyms"
    | "schemas";

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
            parts.push(enc(path.connectionId), path.folder);
            break;
        case "database":
            parts.push(enc(path.connectionId), enc(path.database));
            break;
        case "databaseFolder":
            parts.push(enc(path.connectionId), enc(path.database), path.folder);
            break;
        case "schema":
            parts.push(enc(path.connectionId), enc(path.database), enc(path.schema));
            break;
        case "schemaFolder":
            parts.push(enc(path.connectionId), enc(path.database), enc(path.schema), path.folder);
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
        switch (kind) {
            case "root":
                return { kind: "root" };
            case "connectionGroup":
                return { kind, groupId: dec(parts[1]) };
            case "connection":
                return { kind, connectionId: dec(parts[1]) };
            case "serverFolder":
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    folder: parts[2] as OeV2ServerFolder,
                };
            case "database":
                return { kind, connectionId: dec(parts[1]), database: dec(parts[2]) };
            case "databaseFolder":
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    database: dec(parts[2]),
                    folder: parts[3] as OeV2DatabaseFolder,
                };
            case "schema":
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    database: dec(parts[2]),
                    schema: dec(parts[3]),
                };
            case "schemaFolder":
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    database: dec(parts[2]),
                    schema: dec(parts[3]),
                    folder: parts[4] as OeV2DatabaseFolder,
                };
            case "object":
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    database: dec(parts[2]),
                    schema: dec(parts[3]),
                    name: dec(parts[4]),
                    objectKind: parts[5] as OeV2ObjectKind,
                };
            case "objectFolder":
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    database: dec(parts[2]),
                    schema: dec(parts[3]),
                    name: dec(parts[4]),
                    objectKind: parts[5] as OeV2ObjectKind,
                    folder: parts[6] as OeV2ObjectFolder,
                };
            case "column":
                return {
                    kind,
                    connectionId: dec(parts[1]),
                    database: dec(parts[2]),
                    schema: dec(parts[3]),
                    objectName: dec(parts[4]),
                    column: dec(parts[5]),
                };
            case "parameter": {
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
                const connectionId = dec(parts[2] ?? "");
                return {
                    kind,
                    scope: dec(parts[1]),
                    ...(connectionId ? { connectionId } : {}),
                };
            }
            case "error": {
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
