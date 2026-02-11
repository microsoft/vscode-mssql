/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserSurveyReducers, UserSurveyState } from "../../../sharedInterfaces/userSurvey";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useUserSurveySelector<T>(
    selector: (state: UserSurveyState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<UserSurveyState, UserSurveyReducers, T>(selector, equals);
}
