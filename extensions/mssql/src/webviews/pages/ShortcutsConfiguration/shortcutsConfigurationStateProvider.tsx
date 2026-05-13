/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, ReactNode, useMemo } from "react";
import {
    ShortcutsConfigurationContextProps,
    ShortcutsConfigurationReducers,
    ShortcutsConfigurationWebviewState,
    SaveShortcutsConfigurationPayload,
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
            saveConfiguration: (payload: SaveShortcutsConfigurationPayload) =>
                extensionRpc.action("saveConfiguration", payload),
            reloadConfiguration: () => extensionRpc.action("reloadConfiguration", {}),
            closeDialog: () => extensionRpc.action("closeDialog", {}),
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
