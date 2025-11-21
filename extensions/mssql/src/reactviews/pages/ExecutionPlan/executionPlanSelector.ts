/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  ExecutionPlanReducers,
  ExecutionPlanWebviewState,
} from "../../../sharedInterfaces/executionPlan";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useExecutionPlanSelector<T>(
  selector: (state: ExecutionPlanWebviewState) => T,
  equals: (a: T, b: T) => boolean = Object.is,
) {
  return useVscodeSelector<ExecutionPlanWebviewState, ExecutionPlanReducers, T>(
    selector,
    equals,
  );
}
