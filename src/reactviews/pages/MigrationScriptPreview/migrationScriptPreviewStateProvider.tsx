/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, ReactNode } from "react";
import {
    MigrationScriptPreviewState,
    MigrationScriptPreviewReducers,
} from "../../../sharedInterfaces/migrationScriptPreview";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";
import { ColorThemeKind, CoreRPCs } from "../../../sharedInterfaces/webview";

export interface MigrationScriptPreviewContextType extends CoreRPCs {
    state: MigrationScriptPreviewState | undefined;
    themeKind: ColorThemeKind | undefined;
    executeScript: () => void;
    cancel: () => void;
}

export const MigrationScriptPreviewContext = createContext<
    MigrationScriptPreviewContextType | undefined
>(undefined);

interface MigrationScriptPreviewProviderProps {
    children: ReactNode;
}

const MigrationScriptPreviewStateProvider: React.FC<MigrationScriptPreviewProviderProps> = ({
    children,
}) => {
    const webviewContext = useVscodeWebview<
        MigrationScriptPreviewState,
        MigrationScriptPreviewReducers
    >();

    return (
        <MigrationScriptPreviewContext.Provider
            value={{
                state: webviewContext?.state,
                themeKind: webviewContext?.themeKind,
                ...getCoreRPCs(webviewContext),
                executeScript: () => {
                    webviewContext?.extensionRpc.action("executeScript");
                },
                cancel: () => {
                    webviewContext?.extensionRpc.action("cancel");
                },
            }}>
            {children}
        </MigrationScriptPreviewContext.Provider>
    );
};

export { MigrationScriptPreviewStateProvider };
