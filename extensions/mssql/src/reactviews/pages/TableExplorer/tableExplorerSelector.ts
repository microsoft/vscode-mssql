/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  TableExplorerReducers,
  TableExplorerWebViewState,
} from "../../../sharedInterfaces/tableExplorer";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useTableExplorerSelector<T>(
  selector: (state: TableExplorerWebViewState) => T,
  equals: (a: T, b: T) => boolean = Object.is,
) {
  return useVscodeSelector<TableExplorerWebViewState, TableExplorerReducers, T>(
    selector,
    equals,
  );
}
