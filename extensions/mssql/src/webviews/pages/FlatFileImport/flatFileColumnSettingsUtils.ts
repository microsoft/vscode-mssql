/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangeColumnSettingsParams, ColumnInfo } from "../../../models/contracts/flatFile";

/** Applies the user's saved edits to the column metadata inferred from the imported file. */
export function applyColumnChanges(
    column: ColumnInfo,
    changes: ChangeColumnSettingsParams | undefined,
): ColumnInfo {
    return {
        ...column,
        name: changes?.newName ?? column.name,
        sqlType: changes?.newDataType ?? column.sqlType,
        isNullable: changes?.newNullable ?? column.isNullable,
        isInPrimaryKey: changes?.newInPrimaryKey ?? column.isInPrimaryKey,
    };
}
