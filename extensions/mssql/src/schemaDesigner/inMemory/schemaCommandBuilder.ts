/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../sharedInterfaces/schemaDesigner";
import { CommandGraph, CommandPhase } from "./commandGraph";
import { TableHandler } from "./handlers/tableHandler";
import { SchemaCommandContext, SchemaObjectHandler } from "./schemaObjectHandler";
import { SchemaSqlBuilder } from "./schemaSqlBuilder";

export interface SchemaCommandBuilderOptions {
    original: SchemaDesigner.Schema;
    updated: SchemaDesigner.Schema;
    sqlBuilder: SchemaSqlBuilder;
    handlers?: SchemaObjectHandler[];
}

export class SchemaCommandBuilder {
    private readonly _handlers: SchemaObjectHandler[];

    constructor(private readonly _options: SchemaCommandBuilderOptions) {
        this._handlers = _options.handlers ?? [new TableHandler()];
    }

    public build(): CommandGraph {
        const graph = new CommandGraph();
        const context = new DefaultSchemaCommandContext(
            this._options.original,
            this._options.updated,
            graph,
            this._options.sqlBuilder,
        );
        for (const handler of this._handlers) {
            handler.buildCommands(context);
        }
        return graph;
    }
}

class DefaultSchemaCommandContext implements SchemaCommandContext {
    constructor(
        public readonly originalSchema: SchemaDesigner.Schema,
        public readonly updatedSchema: SchemaDesigner.Schema,
        public readonly graph: CommandGraph,
        public readonly sqlBuilder: SchemaSqlBuilder,
    ) {}

    createCommandId(type: string, ...parts: string[]): string {
        const sanitized = parts.map((part) => part.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase());
        return [type, ...sanitized].join("_");
    }

    addCommand(
        id: string,
        phase: CommandPhase,
        statements: string[],
        dependencies: string[] = [],
        description?: string,
    ): boolean {
        const filtered = statements.filter((stmt) => stmt && stmt.trim().length > 0);
        if (filtered.length === 0) {
            return false;
        }
        this.graph.addCommand({
            id,
            phase,
            statements: filtered,
            description,
            dependencies: new Set(dependencies),
        });
        return true;
    }
}
