/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CoreRPCs } from "./webview";

export const quickQueryCount = 10;
export const quickQueryCommandPrefix = "mssql.quickQueries.run";

export enum QuickQueryExecutionMode {
    Open = "open",
    OpenAndRun = "openAndRun",
}

export enum QuickQueryConnectionMode {
    ActiveOrPrompt = "activeOrPrompt",
    Prompt = "prompt",
}

export interface QuickQuerySlot {
    name: string;
    query: string;
    executionMode: QuickQueryExecutionMode;
    connectionMode: QuickQueryConnectionMode;
}

export type QuickQueryKeybindings = Record<string, string>;

export interface ShortcutsConfigurationWebviewState {
    quickQueries: QuickQuerySlot[];
    quickQueryKeybindings: QuickQueryKeybindings;
    webviewShortcuts: Record<string, string>;
    focusedQuickQuerySlot?: number;
    message?: string;
    errorMessage?: string;
    isSaving?: boolean;
}

export interface SaveShortcutsConfigurationPayload {
    quickQueries: QuickQuerySlot[];
    quickQueryKeybindings: QuickQueryKeybindings;
    webviewShortcuts: Record<string, string>;
}

export interface ShortcutsConfigurationReducers {
    saveConfiguration: SaveShortcutsConfigurationPayload;
    reloadConfiguration: {};
    closeDialog: {};
}

export interface ShortcutsConfigurationContextProps extends CoreRPCs {
    saveConfiguration: (payload: SaveShortcutsConfigurationPayload) => void;
    reloadConfiguration: () => void;
    closeDialog: () => void;
}

export function getQuickQueryCommandId(slotNumber: number): string {
    return `${quickQueryCommandPrefix}${slotNumber}`;
}

export function getQuickQuerySlotName(slotNumber: number): string {
    return `Quick Query ${slotNumber}`;
}

function isQuickQueryExecutionMode(value: unknown): value is QuickQueryExecutionMode {
    return value === QuickQueryExecutionMode.Open || value === QuickQueryExecutionMode.OpenAndRun;
}

function isQuickQueryConnectionMode(value: unknown): value is QuickQueryConnectionMode {
    return (
        value === QuickQueryConnectionMode.ActiveOrPrompt ||
        value === QuickQueryConnectionMode.Prompt
    );
}

export function createDefaultQuickQuerySlot(slotNumber: number): QuickQuerySlot {
    return {
        name: getQuickQuerySlotName(slotNumber),
        query: "",
        executionMode: QuickQueryExecutionMode.Open,
        connectionMode: QuickQueryConnectionMode.Prompt,
    };
}

export function normalizeQuickQuerySlot(value: unknown, slotNumber: number): QuickQuerySlot {
    const defaults = createDefaultQuickQuerySlot(slotNumber);
    if (!value || typeof value !== "object") {
        return defaults;
    }

    const candidate = value as Partial<QuickQuerySlot>;
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";

    return {
        name: name || defaults.name,
        query: typeof candidate.query === "string" ? candidate.query : defaults.query,
        executionMode: isQuickQueryExecutionMode(candidate.executionMode)
            ? candidate.executionMode
            : defaults.executionMode,
        connectionMode: isQuickQueryConnectionMode(candidate.connectionMode)
            ? candidate.connectionMode
            : defaults.connectionMode,
    };
}

export function normalizeQuickQueries(value: unknown): QuickQuerySlot[] {
    const rawSlots = Array.isArray(value) ? value : [];
    return Array.from({ length: quickQueryCount }, (_unused, index) =>
        normalizeQuickQuerySlot(rawSlots[index], index + 1),
    );
}
