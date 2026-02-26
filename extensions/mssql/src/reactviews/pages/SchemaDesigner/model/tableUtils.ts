/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { v4 as uuidv4 } from "uuid";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { locConstants } from "../../../common/locConstants";
import { namingUtils } from "./namingUtils";

export const tableUtils = {
    getAllTables: (
        schema: SchemaDesigner.Schema,
        current?: SchemaDesigner.Table,
    ): SchemaDesigner.Table[] => {
        return schema.tables.filter((t) => !current || t.id !== current.id).sort();
    },

    getTableFromDisplayName: (
        schema: SchemaDesigner.Schema,
        displayName: string,
    ): SchemaDesigner.Table => {
        return schema.tables.find((t) => `${t.schema}.${t.name}` === displayName)!;
    },

    tableNameValidationError: (
        schema: SchemaDesigner.Schema,
        table: SchemaDesigner.Table,
    ): string | undefined => {
        const conflict = schema.tables.find(
            (t) =>
                t.name.toLowerCase() === table.name.toLowerCase() &&
                t.schema.toLowerCase() === table.schema.toLowerCase() &&
                t.id !== table.id,
        );

        if (conflict) {
            return locConstants.schemaDesigner.tableNameRepeatedError(table.name);
        }
        if (!table.name) {
            return locConstants.schemaDesigner.tableNameEmptyError;
        }
        return undefined;
    },

    createNewTable: (
        schema: SchemaDesigner.Schema,
        schemaNames: string[],
    ): SchemaDesigner.Table => {
        const name = namingUtils.getNextTableName(schema.tables);
        return {
            name,
            schema: schemaNames[0],
            columns: [
                {
                    name: "Id",
                    dataType: "int",
                    maxLength: "",
                    precision: 0,
                    scale: 0,
                    isNullable: false,
                    isPrimaryKey: true,
                    id: uuidv4(),
                    isIdentity: true,
                    identitySeed: 1,
                    identityIncrement: 1,
                    defaultValue: "",
                    isComputed: false,
                    computedFormula: "",
                    computedPersisted: false,
                },
            ],
            foreignKeys: [],
            id: uuidv4(),
        };
    },
};
