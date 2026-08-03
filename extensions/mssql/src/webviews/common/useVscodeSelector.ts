/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useEffect, useReducer, useRef } from "react";
import { VscodeWebviewContext, VscodeWebviewContextProps } from "./vscodeWebviewProvider";

/**
 * Read a tiny slice of the webview state without causing whole-app re-renders.
 * Example:
 *   const propValue = useVscodeSelector<MyState, MyReducers, string|undefined>(s => s.prop);
 */
export function useVscodeSelector<State, Reducers, T>(
    selector: (s: State) => T,
    equals: (a: T, b: T) => boolean = Object.is,
) {
    const ctx = useContext(VscodeWebviewContext) as unknown as VscodeWebviewContextProps<
        State,
        Reducers
    >;
    if (!ctx) throw new Error("useVscodeSelector must be used within a VscodeWebviewProvider");

    // Use a server snapshot function that handles undefined state gracefully
    const getServerSnapshot = useCallback(() => {
        const snapshot = ctx.getSnapshot();
        return snapshot || ({} as State);
    }, [ctx]);

    const selectorRef = useRef(selector);
    const equalsRef = useRef(equals);
    selectorRef.current = selector;
    equalsRef.current = equals;

    const [, forceRender] = useReducer((value: number) => value + 1, 0);
    const selectedRef = useRef<T>(selector((ctx.getSnapshot() || ({} as State)) as State));

    const selected = selector((ctx.getSnapshot() || ({} as State)) as State);
    if (!equals(selectedRef.current, selected)) {
        selectedRef.current = selected;
    }

    useEffect(() => {
        const checkForUpdates = () => {
            const snapshot = getServerSnapshot();
            const nextSelected = selectorRef.current(snapshot);
            if (equalsRef.current(selectedRef.current, nextSelected)) {
                return;
            }

            selectedRef.current = nextSelected;
            forceRender();
        };

        checkForUpdates();
        return ctx.subscribe(checkForUpdates);
    }, [ctx, getServerSnapshot]);

    return selectedRef.current;
}
