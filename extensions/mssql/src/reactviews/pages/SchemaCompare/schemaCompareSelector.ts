/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    SchemaCompareReducers,
    SchemaCompareWebViewState,
} from "../../../sharedInterfaces/schemaCompare";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useSchemaCompareSelector<T>(
    selector: (state: SchemaCompareWebViewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<SchemaCompareWebViewState, SchemaCompareReducers, T>(
        selector,
        equals,
    );
}
