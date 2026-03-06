/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { useVscodeWebviewSelector2 } from "../../common/vscodeWebviewProvider2";

export function useSchemaDesignerSelector<T>(
    selector: (state: SchemaDesigner.SchemaDesignerWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeWebviewSelector2<SchemaDesigner.SchemaDesignerWebviewState, T>(
        selector,
        equals,
    );
}
