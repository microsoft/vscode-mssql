/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, ReactNode, useMemo } from "react";
import {
    ReadClipboardTextRequest,
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
            saveConfiguration: async (payload: SaveShortcutsConfigurationPayload) => {
                await extensionRpc.actionRequest("saveConfiguration", payload);
            },
            saveAndCloseConfiguration: async (payload: SaveShortcutsConfigurationPayload) => {
                await extensionRpc.actionRequest("saveAndCloseConfiguration", payload);
            },
            closeDialog: async () => {
                await extensionRpc.actionRequest("closeDialog", {});
            },
            readClipboardText: async () => {
                return await extensionRpc.sendRequest(ReadClipboardTextRequest.type);
            },
            writeClipboardText: async (text: string) => {
                await extensionRpc.sendRequest(WriteClipboardTextRequest.type, text);
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
