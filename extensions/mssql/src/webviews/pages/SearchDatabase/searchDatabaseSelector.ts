/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    SearchDatabaseReducers,
    SearchDatabaseWebViewState,
} from "../../../sharedInterfaces/searchDatabase";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useSearchDatabaseSelector<T>(
    selector: (state: SearchDatabaseWebViewState) => T,
    equals: (a: T, b: T) => boolean = Object.is,
) {
    return useVscodeSelector<SearchDatabaseWebViewState, SearchDatabaseReducers, T>(
        selector,
        equals,
    );
}
