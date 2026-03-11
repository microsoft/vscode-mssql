/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

export const namingUtils = {
    getNextColumnName: (columns: SchemaDesigner.Column[]): string => {
        let index = 1;
        while (columns.some((c) => c.name === `column_${index}`)) {
            index++;
        }
        return `column_${index}`;
    },

    getNextForeignKeyName: (
        foreignKeys: SchemaDesigner.ForeignKey[],
        tables: SchemaDesigner.Table[],
    ): string => {
        const existingFkNames = new Set<string>();

        for (const table of tables) {
            for (const fk of table.foreignKeys) {
                existingFkNames.add(fk.name);
            }
        }

        for (const fk of foreignKeys) {
            existingFkNames.add(fk.name);
        }

        let index = 1;
        while (existingFkNames.has(`FK_${index}`)) {
            index++;
        }
        return `FK_${index}`;
    },

    getNextTableName: (tables: SchemaDesigner.Table[]): string => {
        let index = 1;
        while (tables.some((t) => t.name === `table_${index}`)) {
            index++;
        }
        return `table_${index}`;
    },
};
