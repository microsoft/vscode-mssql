/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as qr from "../../../sharedInterfaces/queryResult";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useQueryResultSelector<T>(
  selector: (state: qr.QueryResultWebviewState) => T,
  equals: (a: T, b: T) => boolean = Object.is,
) {
  return useVscodeSelector<
    qr.QueryResultWebviewState,
    qr.QueryResultReducers,
    T
  >(selector, equals);
}
