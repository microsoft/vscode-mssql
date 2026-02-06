/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ObjectExplorerFilterState,
    ObjectExplorerReducers,
} from "../../../sharedInterfaces/objectExplorerFilter";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useObjectExplorerFilterSelector<T>(
    selector: (state: ObjectExplorerFilterState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<ObjectExplorerFilterState, ObjectExplorerReducers, T>(
        selector,
        equals,
    );
}
