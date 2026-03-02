/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useMemo } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { WebviewRpc } from "../../common/rpc";
import {
    CodeAnalysisReducers,
    CodeAnalysisState,
    CodeAnalysisProvider,
} from "../../../sharedInterfaces/codeAnalysis";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";

export interface CodeAnalysisContextProps extends CodeAnalysisProvider {
    extensionRpc: WebviewRpc<CodeAnalysisReducers>;
    themeKind?: ColorThemeKind;
}

export const CodeAnalysisContext = createContext<CodeAnalysisContextProps | undefined>(undefined);

export const CodeAnalysisStateProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const { extensionRpc, themeKind } = useVscodeWebview<CodeAnalysisState, CodeAnalysisReducers>();

    const value = useMemo<CodeAnalysisContextProps>(
        () => ({
            close: () => extensionRpc.action("close", {}),
            closeMessage: () => extensionRpc.action("closeMessage", {}),
            saveRules: (rules, closeAfterSave, enableCodeAnalysisOnBuild) =>
                extensionRpc.action("saveRules", {
                    rules,
                    closeAfterSave,
                    enableCodeAnalysisOnBuild,
                }),
            extensionRpc,
            themeKind,
        }),
        [extensionRpc, themeKind],
    );

    return <CodeAnalysisContext.Provider value={value}>{children}</CodeAnalysisContext.Provider>;
};
