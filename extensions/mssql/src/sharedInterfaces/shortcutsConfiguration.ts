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

export interface ShortcutsConfigurationData {
    quickQueries: QuickQuerySlot[];
    webviewShortcuts: Record<string, string>;
}

export interface ConfigurableKeyCommand {
    command: string;
    label: string;
    description: string;
    category: "queryExecution" | "connection" | "others";
}

export interface ShortcutsConfigurationWebviewState {
    focusedQuickQuerySlot?: number;
    focusNonce?: number;
    errorMessage?: string;
}

export interface SaveShortcutsConfigurationChangedSections {
    quickQueries?: boolean;
    webviewShortcuts?: boolean;
}

export interface SaveShortcutsConfigurationPayload {
    quickQueries: QuickQuerySlot[];
    webviewShortcuts: Record<string, string>;
    changedSections?: SaveShortcutsConfigurationChangedSections;
}

export interface SaveShortcutsConfigurationResult {
    message?: string;
    errorMessage?: string;
}

export interface ShortcutsConfigurationReducers {}

export namespace ReadShortcutsConfigurationRequest {
    export const type = new RequestType<void, ShortcutsConfigurationData, void>(
        "shortcutsConfiguration/readConfiguration",
    );
}

export namespace SaveShortcutsConfigurationRequest {
    export const type = new RequestType<
        SaveShortcutsConfigurationPayload,
        SaveShortcutsConfigurationResult,
        void
    >("shortcutsConfiguration/saveConfiguration");
}

export namespace SaveAndCloseShortcutsConfigurationRequest {
    export const type = new RequestType<
        SaveShortcutsConfigurationPayload,
        SaveShortcutsConfigurationResult,
        void
    >("shortcutsConfiguration/saveAndCloseConfiguration");
}

export namespace CloseShortcutsConfigurationRequest {
    export const type = new RequestType<void, void, void>("shortcutsConfiguration/closeDialog");
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

export namespace OpenQuickQueryKeybindingRequest {
    export const type = new RequestType<string, void, void>(
        "shortcutsConfiguration/openQuickQueryKeybinding",
    );
}

export namespace OpenQuickQueryKeybindingsRequest {
    export const type = new RequestType<void, void, void>(
        "shortcutsConfiguration/openQuickQueryKeybindings",
    );
}

export namespace OpenKeymapCommandKeybindingRequest {
    export const type = new RequestType<string, void, void>(
        "shortcutsConfiguration/openKeymapCommandKeybinding",
    );
}

export namespace OpenKeymapCommandKeybindingsRequest {
    export const type = new RequestType<void, void, void>(
        "shortcutsConfiguration/openKeymapCommandKeybindings",
    );
}

export interface ShortcutsConfigurationContextProps extends CoreRPCs {
    readConfiguration: () => Promise<ShortcutsConfigurationData>;
    saveConfiguration: (
        payload: SaveShortcutsConfigurationPayload,
    ) => Promise<SaveShortcutsConfigurationResult>;
    saveAndCloseConfiguration: (
        payload: SaveShortcutsConfigurationPayload,
    ) => Promise<SaveShortcutsConfigurationResult>;
    closeDialog: () => Promise<void>;
    readClipboardText: () => Promise<string>;
    writeClipboardText: (text: string) => Promise<void>;
    openQuickQueryKeybinding: (commandId: string) => Promise<void>;
    openQuickQueryKeybindings: () => Promise<void>;
    openKeymapCommandKeybinding: (commandId: string) => Promise<void>;
    openKeymapCommandKeybindings: () => Promise<void>;
}

export const configurableKeyCommands: ConfigurableKeyCommand[] = [
    {
        command: "mssql.runQuery",
        label: "Execute Query",
        description: "Run a query for the current active SQL document",
        category: "queryExecution",
    },
    {
        command: "mssql.runCurrentStatement",
        label: "Execute Selection or Current Statement",
        description: "Execute only the T-SQL statement under the cursor",
        category: "queryExecution",
    },
    {
        command: "mssql.cancelQuery",
        label: "Cancel Query",
        description: "Cancel the query execution in progress",
        category: "queryExecution",
    },
    {
        command: "mssql.newQuery",
        label: "New Query",
        description: "Open a new SQL query file",
        category: "queryExecution",
    },
    {
        command: "mssql.showEstimatedPlan",
        label: "Show Estimated Plan",
        description: "View the estimated query execution plan",
        category: "others",
    },
    {
        command: "mssql.toggleActualPlan",
        label: "Toggle Actual Plan",
        description: "Toggle actual execution plan collection for SQL queries",
        category: "others",
    },
    {
        command: "mssql.copyAll",
        label: "Copy All",
        description: "Copy all query result content",
        category: "others",
    },
    {
        command: "mssql.toggleQueryResultPanel",
        label: "Toggle Query Result Panel",
        description: "Show or hide the query result panel",
        category: "others",
    },
];

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
