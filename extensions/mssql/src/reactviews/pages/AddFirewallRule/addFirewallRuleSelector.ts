/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AddFirewallRuleReducers,
    AddFirewallRuleState,
} from "../../../sharedInterfaces/addFirewallRule";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useAddFirewallRuleSelector<T>(
    selector: (state: AddFirewallRuleState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<AddFirewallRuleState, AddFirewallRuleReducers, T>(selector, equals);
}
