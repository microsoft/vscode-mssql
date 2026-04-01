/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useSchemaDesignerSelector<T>(
    selector: (state: SchemaDesigner.SchemaDesignerWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers,
        T
    >(selector, equals);
}
