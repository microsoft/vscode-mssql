/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc";
import { CoreRPCs } from "./webview";

export const quickQueryCount = 10;
export const quickQueryCommandPrefix = "mssql.quickQueries.run";

export enum QuickQueryExecutionMode {
    Open = "open",
    OpenAndRun = "openAndRun",
}

export interface QuickQuerySlot {
    name: string;
    query: string;
    executionMode: QuickQueryExecutionMode;
}

export type QuickQueryKeybindings = Record<string, string>;

export interface ShortcutsConfigurationWebviewState {
    quickQueries: QuickQuerySlot[];
    quickQueryKeybindings: QuickQueryKeybindings;
    webviewShortcuts: Record<string, string>;
    focusedQuickQuerySlot?: number;
    focusNonce?: number;
    message?: string;
    errorMessage?: string;
    isSaving?: boolean;
}

export interface SaveShortcutsConfigurationChangedSections {
    quickQueries?: boolean;
    quickQueryKeybindings?: boolean;
    webviewShortcuts?: boolean;
}

export interface SaveShortcutsConfigurationPayload {
    quickQueries: QuickQuerySlot[];
    quickQueryKeybindings: QuickQueryKeybindings;
    webviewShortcuts: Record<string, string>;
    changedSections?: SaveShortcutsConfigurationChangedSections;
}

export interface ShortcutsConfigurationReducers {
    saveConfiguration: SaveShortcutsConfigurationPayload;
    saveAndCloseConfiguration: SaveShortcutsConfigurationPayload;
    closeDialog: {};
}

export namespace ReadClipboardTextRequest {
    export const type = new RequestType<void, string, void>(
        "shortcutsConfiguration/readClipboardText",
    );
}

export namespace WriteClipboardTextRequest {
    export const type = new RequestType<string, void, void>(
        "shortcutsConfiguration/writeClipboardText",
    );
}

export interface ShortcutsConfigurationContextProps extends CoreRPCs {
    saveConfiguration: (payload: SaveShortcutsConfigurationPayload) => Promise<void>;
    saveAndCloseConfiguration: (payload: SaveShortcutsConfigurationPayload) => Promise<void>;
    closeDialog: () => Promise<void>;
    readClipboardText: () => Promise<string>;
    writeClipboardText: (text: string) => Promise<void>;
}

export function getQuickQueryCommandId(slotNumber: number): string {
    return `${quickQueryCommandPrefix}${slotNumber}`;
}

export function getQuickQuerySlotName(slotNumber: number): string {
    return `Query ${slotNumber}`;
}

function isQuickQueryExecutionMode(value: unknown): value is QuickQueryExecutionMode {
    return value === QuickQueryExecutionMode.Open || value === QuickQueryExecutionMode.OpenAndRun;
}

export function createDefaultQuickQuerySlot(slotNumber: number): QuickQuerySlot {
    return {
        name: getQuickQuerySlotName(slotNumber),
        query: "",
        executionMode: QuickQueryExecutionMode.Open,
    };
}

export function normalizeQuickQuerySlot(value: unknown, slotNumber: number): QuickQuerySlot {
    const defaults = createDefaultQuickQuerySlot(slotNumber);
    if (!value || typeof value !== "object") {
        return defaults;
    }

    const candidate = value as Partial<QuickQuerySlot>;
    const name =
        typeof candidate.name === "string" && candidate.name.trim().length > 0
            ? candidate.name.trim()
            : defaults.name;

    return {
        name,
        query: typeof candidate.query === "string" ? candidate.query : defaults.query,
        executionMode: isQuickQueryExecutionMode(candidate.executionMode)
            ? candidate.executionMode
            : defaults.executionMode,
    };
}

export function normalizeQuickQueries(value: unknown): QuickQuerySlot[] {
    const rawSlots = Array.isArray(value) ? value : [];
    return Array.from({ length: quickQueryCount }, (_unused, index) =>
        normalizeQuickQuerySlot(rawSlots[index], index + 1),
    );
}
