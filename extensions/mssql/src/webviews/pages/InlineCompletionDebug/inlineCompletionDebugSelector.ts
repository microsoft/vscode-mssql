/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Slice reader over the pluggable Inline Completion Debug state store — one
 * code path for every host (final plan WI-1.4). The standalone panel's store
 * adapts the reducer-framework webview snapshot; the Debug Console's store is
 * composed client-side from the thin typed RPC transport. The subscription
 * mechanics mirror webviews/common/useVscodeSelector.ts.
 */

import { useEffect, useReducer, useRef } from "react";
import { InlineCompletionDebugWebviewState } from "../../../sharedInterfaces/inlineCompletionDebug";
import { useIcDebugStateStore } from "./inlineCompletionDebugStateProvider";

export function useInlineCompletionDebugSelector<T>(
    selector: (state: InlineCompletionDebugWebviewState) => T,
    equals: (left: T, right: T) => boolean = Object.is,
) {
    const store = useIcDebugStateStore();

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
