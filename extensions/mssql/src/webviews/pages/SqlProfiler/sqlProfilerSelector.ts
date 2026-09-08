/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlProfilerReducers, SqlProfilerState } from "../../../sharedInterfaces/sqlProfiler";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useSqlProfilerSelector<T>(
    selector: (state: SqlProfilerState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<SqlProfilerState, SqlProfilerReducers, T>(selector, equals);
}
