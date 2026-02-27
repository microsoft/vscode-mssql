/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    FlatFileImportReducers,
    FlatFileImportState,
} from "../../../sharedInterfaces/flatFileImport";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useFlatFileSelector<T>(
    selector: (state: FlatFileImportState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<FlatFileImportState, FlatFileImportReducers, T>(selector, equals);
}
