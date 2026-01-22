/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useState } from "react";
import { vsCodeApiInstance } from "../../../common/acquireVsCodeApi";

/**
 * Key for storing diff viewer UI state in webview state
 */
const DIFF_VIEWER_UI_STATE_KEY = "diffViewerUIState";

/**
 * Interface for diff viewer UI state that should be persisted
 */
interface DiffViewerUIState {
    drawerWidth?: number;
}

/**
 * Get the VS Code API instance for state persistence
 */
const vscodeApi = vsCodeApiInstance.vscodeApiInstance;

/**
 * Retrieves the persisted diff viewer UI state from webview state
 */
function getPersistedState(): DiffViewerUIState {
    try {
        const state = vscodeApi.getState() as Record<string, unknown> | undefined;
        if (state && typeof state === "object" && DIFF_VIEWER_UI_STATE_KEY in state) {
            return state[DIFF_VIEWER_UI_STATE_KEY] as DiffViewerUIState;
        }
    } catch {
        // Ignore errors - state may not be available
    }
    return {};
}

/**
 * Persists the diff viewer UI state to webview state
 */
function setPersistedState(uiState: DiffViewerUIState): void {
    try {
        const currentState = (vscodeApi.getState() as Record<string, unknown>) ?? {};
        vscodeApi.setState({
            ...currentState,
            [DIFF_VIEWER_UI_STATE_KEY]: uiState,
        });
    } catch {
        // Ignore errors - state may not be available
    }
}

/**
 * Hook for persisting drawer width across webview reloads.
 * Uses the VS Code webview state API for persistence.
 *
 * @param defaultWidth - Default width to use if no persisted value exists
 * @returns [currentWidth, setWidth] - Current width and setter function
 */
export function usePersistedDrawerWidth(defaultWidth: number): [number, (width: number) => void] {
    const [width, setWidthState] = useState<number>(() => {
        const persisted = getPersistedState();
        return persisted.drawerWidth ?? defaultWidth;
    });

    // Persist width changes
    const setWidth = useCallback((newWidth: number) => {
        setWidthState(newWidth);
        const currentUIState = getPersistedState();
        setPersistedState({
            ...currentUIState,
            drawerWidth: newWidth,
        });
    }, []);

    return [width, setWidth];
}

/**
 * Get the persisted drawer width without using hooks.
 * Useful for initial values when hooks can't be used.
 */
export function getPersistedDrawerWidth(defaultWidth: number): number {
    const persisted = getPersistedState();
    return persisted.drawerWidth ?? defaultWidth;
}
