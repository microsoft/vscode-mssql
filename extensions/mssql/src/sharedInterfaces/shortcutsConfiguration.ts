/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc";
import { CoreRPCs } from "./webview";

export const quickQueryCount = 10;
export const quickQueryCommandPrefix = "mssql.quickQueries.run";

export interface QuickQuerySlot {
    name: string;
    query: string;
}

export interface ShortcutsConfigurationData {
    quickQueries: QuickQuerySlot[];
    webviewShortcuts: Record<string, string>;
}

export type ConfigurableKeyCommandCategory = "queryExecution" | "connection" | "others";

export type ConfigurableKeyCommandId =
    | "mssql.runQuery"
    | "mssql.runCurrentStatement"
    | "mssql.cancelQuery"
    | "mssql.newQuery"
    | "mssql.toggleSqlCmd"
    | "mssql.connect"
    | "mssql.disconnect"
    | "mssql.changeConnection"
    | "mssql.changeDatabase"
    | "mssql.showEstimatedPlan"
    | "mssql.toggleActualPlan"
    | "mssql.copyAll"
    | "mssql.toggleQueryResultPanel";

export interface ConfigurableKeyCommand {
    command: ConfigurableKeyCommandId;
    category: ConfigurableKeyCommandCategory;
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
        category: "queryExecution",
    },
    {
        command: "mssql.runCurrentStatement",
        category: "queryExecution",
    },
    {
        command: "mssql.cancelQuery",
        category: "queryExecution",
    },
    {
        command: "mssql.newQuery",
        category: "queryExecution",
    },
    {
        command: "mssql.toggleSqlCmd",
        category: "queryExecution",
    },
    {
        command: "mssql.connect",
        category: "connection",
    },
    {
        command: "mssql.disconnect",
        category: "connection",
    },
    {
        command: "mssql.changeConnection",
        category: "connection",
    },
    {
        command: "mssql.changeDatabase",
        category: "connection",
    },
    {
        command: "mssql.showEstimatedPlan",
        category: "others",
    },
    {
        command: "mssql.toggleActualPlan",
        category: "others",
    },
    {
        command: "mssql.copyAll",
        category: "others",
    },
    {
        command: "mssql.toggleQueryResultPanel",
        category: "others",
    },
];

export function getQuickQueryCommandId(slotNumber: number): string {
    return `${quickQueryCommandPrefix}${slotNumber}`;
}

export function getQuickQuerySlotName(slotNumber: number): string {
    return `Query ${slotNumber}`;
}

export function createDefaultQuickQuerySlot(slotNumber: number): QuickQuerySlot {
    return {
        name: getQuickQuerySlotName(slotNumber),
        query: "",
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
    };
}

export function normalizeQuickQueries(value: unknown): QuickQuerySlot[] {
    const rawSlots = Array.isArray(value) ? value : [];
    return Array.from({ length: quickQueryCount }, (_unused, index) =>
        normalizeQuickQuerySlot(rawSlots[index], index + 1),
    );
}
