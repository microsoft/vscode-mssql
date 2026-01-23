/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../sharedInterfaces/schemaDesigner";
import { CommandGraph, CommandPhase } from "./commandGraph";
import { SchemaSqlBuilder } from "./schemaSqlBuilder";

export interface SchemaCommandContext {
    readonly originalSchema: SchemaDesigner.Schema;
    readonly updatedSchema: SchemaDesigner.Schema;
    readonly graph: CommandGraph;
    readonly sqlBuilder: SchemaSqlBuilder;
    createCommandId(type: string, ...parts: string[]): string;
    addCommand(
        id: string,
        phase: CommandPhase,
        statements: string[],
        dependencies?: string[],
        description?: string,
    ): boolean;
}

export interface SchemaObjectHandler {
    buildCommands(context: SchemaCommandContext): void;
}
