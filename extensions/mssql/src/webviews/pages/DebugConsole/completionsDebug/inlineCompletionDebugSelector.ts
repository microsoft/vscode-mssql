/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// FORKED from webviews/pages/InlineCompletionDebug/inlineCompletionDebugSelector.ts —
// console-hosted copy; the standalone panel remains the reference until replay parity is
// confirmed, then it gets deleted.
//
// Same hook name/shape as the standalone selector, but it reads the pulled console-side
// state store instead of the reducer-framework webview state (the DebugConsole webview's
// VscodeWebviewProvider snapshot holds DebugConsoleState, not this feature's state). The
// subscription mechanics mirror webviews/common/useVscodeSelector.ts.

import { useEffect, useReducer, useRef } from "react";
import { InlineCompletionDebugWebviewState } from "../../../../sharedInterfaces/inlineCompletionDebug";
import { useConsoleIcDebugStateStore } from "./consoleStateProvider";

export function useInlineCompletionDebugSelector<T>(
    selector: (state: InlineCompletionDebugWebviewState) => T,
    equals: (left: T, right: T) => boolean = Object.is,
) {
    const store = useConsoleIcDebugStateStore();

    const selectorRef = useRef(selector);
    const equalsRef = useRef(equals);
    selectorRef.current = selector;
    equalsRef.current = equals;

    const [, forceRender] = useReducer((value: number) => value + 1, 0);
    const selectedRef = useRef<T>(selector(store.getSnapshot()));

    const selected = selector(store.getSnapshot());
    if (!equals(selectedRef.current, selected)) {
        selectedRef.current = selected;
    }

    useEffect(() => {
        const checkForUpdates = () => {
            const nextSelected = selectorRef.current(store.getSnapshot());
            if (equalsRef.current(selectedRef.current, nextSelected)) {
                return;
            }

            selectedRef.current = nextSelected;
            forceRender();
        };

        checkForUpdates();
        return store.subscribe(checkForUpdates);
    }, [store]);

    return selectedRef.current;
}
