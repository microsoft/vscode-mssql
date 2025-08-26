/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useRef, useSyncExternalStore } from "react";
import { IVscodeWebviewContext2, VscodeWebviewContext2 } from "./vscodeWebviewProvider2";

/**
 * Read a tiny slice of the webview state without causing whole-app re-renders.
 * Example:
 *   const uri = useVscodeSelector<MyState, MyReducers, string|undefined>(s => s.uri);
 */
export function useVscodeSelector<State, Reducers, T>(
    selector: (s: State) => T,
    equals: (a: T, b: T) => boolean = Object.is,
) {
    const ctx = useContext(VscodeWebviewContext2) as unknown as IVscodeWebviewContext2<
        State,
        Reducers
    >;
    if (!ctx) throw new Error("useVscodeSelector must be used within a VscodeWebviewProvider");

    // Use a server snapshot function that handles undefined state gracefully
    const getServerSnapshot = useCallback(() => {
        const snapshot = ctx.getSnapshot();
        // Return empty object if state is not yet initialized to prevent hydration mismatches
        return snapshot || ({} as State);
    }, [ctx]);

    const snap = useSyncExternalStore(ctx.subscribe, ctx.getSnapshot, getServerSnapshot);

    // Safely handle selection when state might be uninitialized
    const selected = snap ? selector(snap) : (undefined as T);
    const ref = useRef(selected);

    // Only update ref if we have a valid selection and it's different
    if (selected !== undefined && !equals(ref.current, selected)) {
        ref.current = selected;
    }

    return ref.current;
}
