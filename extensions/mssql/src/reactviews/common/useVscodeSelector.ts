/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useVscodeWebviewSelector } from "./vscodeWebviewProvider";

/**
 * Read a tiny slice of the webview state without causing whole-app re-renders.
 * Example:
 *   const propValue = useVscodeSelector<MyState, string|undefined>(s => s.prop);
 */
export function useVscodeSelector<State, T>(
    selector: (s: State) => T,
    equals: (a: T, b: T) => boolean = Object.is,
) {
    return useVscodeWebviewSelector<State, T>(selector, equals);
}
