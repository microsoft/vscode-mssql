/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { FluentResultGridOverlayHost } from "./internal/FluentResultGridMenuOverlay";
import type { FluentResultGridKeyBindingMap } from "./types/fluentResultGridCommands";
import type {
    FluentResultGridActiveOverlayState,
    FluentResultGridDismissibleOverlayState,
    FluentResultGridOverlayState,
} from "./internal/fluentResultGridOverlays";
import type {
    FluentResultGridProviderContextValue,
    FluentResultGridProviderProps,
} from "./internal/fluentResultGridProviderTypes";

const FluentResultGridContext = createContext<FluentResultGridProviderContextValue | undefined>(
    undefined,
);

const emptyKeyBindings: FluentResultGridKeyBindingMap = Object.freeze({});
const noOverlay = { kind: "none" } as const satisfies FluentResultGridOverlayState;

function isDismissibleOverlay(
    overlay: FluentResultGridOverlayState,
): overlay is FluentResultGridDismissibleOverlayState {
    return "onDismiss" in overlay;
}

function notifyOverlayDismiss(overlay: FluentResultGridOverlayState): void {
    if (isDismissibleOverlay(overlay)) {
        overlay.onDismiss();
    }
}

/**
 * Provides shared FluentResultGrid configuration and coordinates grid-owned overlays for every
 * grid rendered below it.
 */
export function FluentResultGridProvider({
    children,
    strings,
    keyBindings = emptyKeyBindings,
    theme,
    defaultCommands,
}: FluentResultGridProviderProps) {
    const [overlay, setOverlay] = useState<FluentResultGridOverlayState>(noOverlay);

    const closeOverlay = useCallback(() => {
        setOverlay((current) => {
            notifyOverlayDismiss(current);
            return noOverlay;
        });
    }, []);

    const openOverlay = useCallback((nextOverlay: FluentResultGridActiveOverlayState) => {
        setOverlay((current) => {
            notifyOverlayDismiss(current);
            return nextOverlay;
        });
    }, []);

    const value = useMemo<FluentResultGridProviderContextValue>(
        () => ({
            strings,
            keyBindings,
            theme,
            defaultCommands,
            overlay,
            openOverlay,
            closeOverlay,
        }),
        [closeOverlay, defaultCommands, keyBindings, openOverlay, overlay, strings, theme],
    );

    return (
        <FluentResultGridContext.Provider value={value}>
            {children}
            <FluentResultGridOverlayHost
                overlay={overlay}
                closeOverlay={closeOverlay}
                strings={strings}
                keyBindings={keyBindings}
                defaultCommands={defaultCommands}
            />
        </FluentResultGridContext.Provider>
    );
}

/**
 * Internal hook for FluentResultGrid and grid-owned overlays.
 * Do not export this from the public package barrel.
 */
export function useFluentResultGridProvider(): FluentResultGridProviderContextValue {
    const context = useContext(FluentResultGridContext);

    if (!context) {
        throw new Error("FluentResultGrid must be rendered inside FluentResultGridProvider.");
    }

    return context;
}
