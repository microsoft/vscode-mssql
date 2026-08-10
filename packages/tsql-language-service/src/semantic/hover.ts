/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    SemanticCatalogProvider,
    SemanticColumn,
    SemanticHoverTarget,
    SemanticObject,
    SemanticParserSnapshot,
    SemanticSpan,
} from "./contracts.js";
import { SemanticObjectResolver } from "./completion.js";
import { DocumentSchemaEvolution } from "./documentSchema.js";
import { normalizeSemanticIdentifier } from "./names.js";

export interface SemanticHover {
    readonly span: SemanticSpan;
    readonly kind: "object" | "column" | "alias" | "routine";
    readonly objectKind?: SemanticObject["kind"];
    readonly name: string;
    readonly multipartName?: readonly string[];
    readonly alias?: string;
    readonly type?: string;
    readonly nullable?: boolean;
    readonly signature?: string;
    readonly markdown: string;
}

export interface SemanticHoverRequest {
    readonly parser: SemanticParserSnapshot;
    readonly offset: number;
    readonly document?: DocumentSchemaEvolution;
    readonly catalog?: SemanticCatalogProvider;
}

/** Builds a transport-neutral hover model from the parser's precise target evidence. */
export class SemanticHoverService {
    public hover(request: SemanticHoverRequest): SemanticHover | undefined {
        const target = request.parser.hoverTargetAt?.(request.offset);
        if (!target) {
            return undefined;
        }
        const resolver = new SemanticObjectResolver(request.document, request.catalog);
        return this.fromTarget(target, resolver);
    }

    public fromTarget(
        target: SemanticHoverTarget,
        resolver: SemanticObjectResolver,
    ): SemanticHover | undefined {
        const object = target.objectParts
            ? resolver.resolve(target.objectParts)
            : target.source?.objectParts
              ? resolver.resolve(target.source.objectParts)
              : undefined;
        if (target.kind === "column") {
            const column = findColumn(target, object, resolver);
            if (!column) return undefined;
            return columnHover(target, column, object);
        }
        if (target.kind === "alias") {
            return aliasHover(target, object);
        }
        if (!object) {
            return undefined;
        }
        return objectHover(target, object);
    }
}

function findColumn(
    target: SemanticHoverTarget,
    object: SemanticObject | undefined,
    resolver: SemanticObjectResolver,
): SemanticColumn | undefined {
    const name = target.columnName ?? target.name;
    const columns =
        target.source?.columns ??
        object?.columns ??
        (target.objectParts ? resolver.columnsFor(target.objectParts) : undefined);
    return columns?.find(
        (column) => normalizeSemanticIdentifier(column.name) === normalizeSemanticIdentifier(name),
    );
}

function objectHover(target: SemanticHoverTarget, object: SemanticObject): SemanticHover {
    const routine = object.kind === "procedure" || object.kind.endsWith("Function");
    const signature = routine ? formatRoutineSignature(object) : undefined;
    const title = routine ? "routine" : object.kind;
    return {
        span: target.span,
        kind: routine ? "routine" : "object",
        objectKind: object.kind,
        name: object.name,
        multipartName: object.parts,
        signature,
        markdown: [
            `**${title}** \`${object.parts.join(".")}\``,
            ...(signature ? [`\`${signature}\``] : []),
        ].join("\n\n"),
    };
}

function columnHover(
    target: SemanticHoverTarget,
    column: SemanticColumn,
    object: SemanticObject | undefined,
): SemanticHover {
    const owner = object?.parts.join(".");
    const nullable = nullableText(column.nullable);
    return {
        span: target.span,
        kind: "column",
        objectKind: object?.kind,
        name: column.name,
        multipartName: object?.parts,
        alias: target.alias ?? target.source?.alias,
        type: column.type,
        nullable: column.nullable,
        markdown: [
            `**column** \`${owner ? `${owner}.` : ""}${column.name}\``,
            column.type ? `\`${column.type}${nullable ? ` ${nullable}` : ""}\`` : undefined,
            target.alias || target.source?.alias
                ? `Alias: \`${target.alias ?? target.source?.alias}\``
                : undefined,
        ]
            .filter((value): value is string => !!value)
            .join("\n\n"),
    };
}

function aliasHover(
    target: SemanticHoverTarget,
    object: SemanticObject | undefined,
): SemanticHover {
    const alias = target.alias ?? target.name;
    const name = object?.parts.join(".") ?? target.source?.name ?? target.name;
    return {
        span: target.span,
        kind: "alias",
        objectKind: object?.kind,
        name,
        multipartName: object?.parts,
        alias,
        markdown: object
            ? `**alias** \`${alias}\` for ${object.kind} \`${object.parts.join(".")}\``
            : `**alias** \`${alias}\``,
    };
}

function formatRoutineSignature(object: SemanticObject): string {
    const parameters = (object.parameters ?? []).map((parameter) => {
        const direction = parameter.direction === "input" || !parameter.direction ? "" : " OUTPUT";
        const optional = parameter.optional ? " = …" : "";
        return `${parameter.name}${parameter.type ? ` ${parameter.type}` : ""}${optional}${direction}`;
    });
    const returns = object.returnType ? ` RETURNS ${object.returnType}` : "";
    return `${object.parts.join(".")}(${parameters.join(", ")})${returns}`;
}

function nullableText(nullable: boolean | undefined): string | undefined {
    return nullable === undefined ? undefined : nullable ? "NULL" : "NOT NULL";
}
