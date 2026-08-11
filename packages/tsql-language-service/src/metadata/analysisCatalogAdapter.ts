/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    SqlCatalogChild,
    SqlCatalogObject,
    SqlCatalogProvider,
} from "../analysis/contracts.js";
import { normalizeIdentifier } from "./catalogSnapshot.js";
import type { SqlMetadataCatalog, SqlMetadataObject } from "./contracts.js";

/** Adapter from the richer metadata repository model to parser-neutral synchronous catalog APIs. */
export class MetadataAnalysisCatalogAdapter implements SqlCatalogProvider {
    public readonly version: string | number;

    public constructor(
        private readonly catalog: SqlMetadataCatalog,
        public readonly world: "open" | "closed" = "closed",
    ) {
        this.version = catalog.version;
    }

    public columnsFor(parts: readonly string[]) {
        return this.catalog.resolve(parts)?.columns.map((column) => ({
            name: column.name,
            type: column.type,
            nullable: column.nullable,
        }));
    }

    public tableCandidates(parts: readonly string[]): readonly (readonly string[])[] {
        return this.catalog
            .search(parts)
            .filter(isRelation)
            .map((object) => [object.schema, object.name]);
    }

    public typeCandidates(parts: readonly string[]): readonly SqlCatalogObject[] {
        return this.catalog
            .search(parts)
            .filter((object) => object.kind === "type" && object.typeKind !== "xmlSchema")
            .map(mapCatalogObject);
    }

    public xmlSchemaCandidates(parts: readonly string[]): readonly SqlCatalogObject[] {
        return this.catalog
            .search(parts)
            .filter((object) => object.kind === "type" && object.typeKind === "xmlSchema")
            .map(mapCatalogObject);
    }

    public childrenOf(prefixParts: readonly string[]): readonly SqlCatalogChild[] {
        if (prefixParts.length === 0) {
            return distinct(
                this.catalog.objects.map((object) => ({
                    name: object.schema,
                    kind: "namespace" as const,
                })),
            );
        }
        const last = normalizeIdentifier(prefixParts.at(-1) ?? "");
        const objects = this.catalog.objects.filter((object) => {
            if (prefixParts.length === 1) {
                return normalizeIdentifier(object.schema) === last;
            }
            return (
                normalizeIdentifier(object.database) ===
                    normalizeIdentifier(prefixParts.at(-2) ?? "") &&
                normalizeIdentifier(object.schema) === last
            );
        });
        return objects.map((object) => ({ name: object.name, kind: "table" as const }));
    }

    public tables(): readonly string[] {
        return this.catalog.objects
            .filter((object) => isRelation(object))
            .map((object) => `${object.schema}.${object.name}`);
    }

    public objectFor(parts: readonly string[]): SqlCatalogObject | undefined {
        const object = this.catalog.resolve(parts);
        if (!object) {
            return undefined;
        }
        return mapCatalogObject(object);
    }
}

function mapCatalogObject(object: SqlMetadataObject): SqlCatalogObject {
    return {
        parts: [object.database, object.schema, object.name],
        kind: object.kind,
        columns: object.columns,
        parameters: object.parameters.map((parameter) => ({
            name: parameter.name,
            type: parameter.type,
            direction: parameter.output ? ("inputOutput" as const) : ("input" as const),
        })),
        returnType: object.returnType,
        synonymTarget: object.synonymTarget,
        typeKind: object.typeKind,
        baseType: object.baseType,
    };
}

function isRelation(object: SqlMetadataObject): boolean {
    return object.kind === "table" || object.kind === "view" || object.kind === "tableFunction";
}

function distinct(children: readonly SqlCatalogChild[]): readonly SqlCatalogChild[] {
    return [
        ...new Map(
            children.map((child) => [`${child.kind}:${normalizeIdentifier(child.name)}`, child]),
        ).values(),
    ];
}
