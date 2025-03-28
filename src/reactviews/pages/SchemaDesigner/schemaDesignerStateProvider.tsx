/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from "react";
import { ISchema, SchemaDesignerWebviewState } from "../../../sharedInterfaces/schemaDesigner";
import { useVscodeWebview, WebviewContextProps } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";

export interface SchemaDesignerContextProps
    extends WebviewContextProps<SchemaDesignerWebviewState> {
    schema: ISchema; // TODO: is this redundant with state.schema?
}

const SchemaDesignerContext = createContext<SchemaDesignerContextProps | undefined>(undefined);

interface SchemaDesignerProviderProps {
    children: React.ReactNode;
}

const SchemaDesignerStateProvider: React.FC<SchemaDesignerProviderProps> = ({ children }) => {
    const webviewState = useVscodeWebview<SchemaDesignerWebviewState, any>();
    return (
        <SchemaDesignerContext.Provider
            value={{
                ...getCoreRPCs(webviewState),
                schema: webviewState.state.schema,
                state: webviewState.state,
                themeKind: webviewState.themeKind,
            }}
        >
            {children}
        </SchemaDesignerContext.Provider>
    );
};

export { SchemaDesignerContext, SchemaDesignerStateProvider };
