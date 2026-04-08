/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ObjectManagementWebviewState } from "../../../../sharedInterfaces/objectManagement";
import {
    RestoreDatabaseFormState,
    RestoreDatabaseReducers,
} from "../../../../sharedInterfaces/restore";
import { useVscodeSelector } from "../../../common/useVscodeSelector";

export function useRestoreDatabaseSelector<T>(
    selector: (state: ObjectManagementWebviewState<RestoreDatabaseFormState>) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<
        ObjectManagementWebviewState<RestoreDatabaseFormState>,
        RestoreDatabaseReducers<RestoreDatabaseFormState>,
        T
    >(selector, equals);
}
