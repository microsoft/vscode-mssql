/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, ReactNode, useMemo } from "react";
import {
    CloseShortcutsConfigurationRequest,
    OpenQuickQueryKeybindingRequest,
    OpenQuickQueryKeybindingsRequest,
    ReadClipboardTextRequest,
    ReadShortcutsConfigurationRequest,
    SaveAndCloseShortcutsConfigurationRequest,
    SaveShortcutsConfigurationRequest,
    ShortcutsConfigurationContextProps,
    ShortcutsConfigurationReducers,
    ShortcutsConfigurationWebviewState,
    SaveShortcutsConfigurationPayload,
    WriteClipboardTextRequest,
} from "../../../sharedInterfaces/shortcutsConfiguration";
import { getCoreRPCs } from "../../common/utils";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";

const ShortcutsConfigurationContext = createContext<ShortcutsConfigurationContextProps | undefined>(
    undefined,
);

const ShortcutsConfigurationStateProvider = ({ children }: { children: ReactNode }) => {
    const { extensionRpc } = useVscodeWebview<
        ShortcutsConfigurationWebviewState,
        ShortcutsConfigurationReducers
    >();

    const commands = useMemo<ShortcutsConfigurationContextProps>(
        () => ({
            ...getCoreRPCs(extensionRpc),
            readConfiguration: async () => {
                return await extensionRpc.sendRequest(ReadShortcutsConfigurationRequest.type);
            },
            saveConfiguration: async (payload: SaveShortcutsConfigurationPayload) => {
                return await extensionRpc.sendRequest(
                    SaveShortcutsConfigurationRequest.type,
                    payload,
                );
            },
            saveAndCloseConfiguration: async (payload: SaveShortcutsConfigurationPayload) => {
                return await extensionRpc.sendRequest(
                    SaveAndCloseShortcutsConfigurationRequest.type,
                    payload,
                );
            },
            closeDialog: async () => {
                await extensionRpc.sendRequest(CloseShortcutsConfigurationRequest.type);
            },
            readClipboardText: async () => {
                return await extensionRpc.sendRequest(ReadClipboardTextRequest.type);
            },
            writeClipboardText: async (text: string) => {
                await extensionRpc.sendRequest(WriteClipboardTextRequest.type, text);
            },
            openQuickQueryKeybinding: async (commandId: string) => {
                await extensionRpc.sendRequest(OpenQuickQueryKeybindingRequest.type, commandId);
            },
            openQuickQueryKeybindings: async () => {
                await extensionRpc.sendRequest(OpenQuickQueryKeybindingsRequest.type);
            },
        }),
        [extensionRpc],
    );

    return (
        <ShortcutsConfigurationContext.Provider value={commands}>
            {children}
        </ShortcutsConfigurationContext.Provider>
    );
};

export { ShortcutsConfigurationContext, ShortcutsConfigurationStateProvider };
