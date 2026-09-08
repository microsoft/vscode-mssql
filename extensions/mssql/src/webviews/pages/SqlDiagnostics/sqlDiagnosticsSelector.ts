/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    SqlDiagnosticsReducers,
    SqlDiagnosticsState,
} from "../../../sharedInterfaces/sqlDiagnostics";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useSqlDiagnosticsSelector<T>(
    selector: (state: SqlDiagnosticsState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<SqlDiagnosticsState, SqlDiagnosticsReducers, T>(selector, equals);
}
