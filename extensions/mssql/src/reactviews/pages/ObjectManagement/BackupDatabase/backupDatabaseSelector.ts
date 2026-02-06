/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ObjectManagementReducers,
    ObjectManagementWebviewState,
} from "../../../../sharedInterfaces/objectManagement";
import { useVscodeSelector } from "../../../common/useVscodeSelector";

export function useBackupDatabaseSelector<T>(
    selector: (state: ObjectManagementWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<ObjectManagementWebviewState, ObjectManagementReducers, T>(
        selector,
        equals,
    );
}
