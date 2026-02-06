/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    TableDesignerReducers,
    TableDesignerWebviewState,
} from "../../../sharedInterfaces/tableDesigner";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useTableDesignerSelector<T>(
    selector: (state: TableDesignerWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<TableDesignerWebviewState, TableDesignerReducers, T>(
        selector,
        equals,
    );
}
