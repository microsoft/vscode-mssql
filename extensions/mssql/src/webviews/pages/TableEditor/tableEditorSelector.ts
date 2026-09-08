/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TableEditorReducers, TableEditorState } from "../../../sharedInterfaces/tableEditor";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useTableEditorSelector<T>(
    selector: (state: TableEditorState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<TableEditorState, TableEditorReducers, T>(selector, equals);
}
