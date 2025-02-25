/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from "react";
import {
    ISchema,
    SchemaDesignerReducers,
    SchemaDesignerWebviewState,
} from "../../../sharedInterfaces/schemaDesigner";
import {
    useVscodeWebview,
    WebviewContextProps,
} from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";
import { WebviewRpc } from "../../common/rpc";

export interface SchemaDesignerContextProps
    extends WebviewContextProps<SchemaDesignerWebviewState> {
    schema: ISchema; // TODO: is this redundant with state.schema?
    extensionRpc: WebviewRpc<SchemaDesignerReducers>;
    saveAs: (
        format: string,
        fileContents: string,
        width: number,
        height: number,
    ) => void;
}

const SchemaDesignerContext = createContext<
    SchemaDesignerContextProps | undefined
>(undefined);

interface SchemaDesignerProviderProps {
    children: React.ReactNode;
}

const SchemaDesignerStateProvider: React.FC<SchemaDesignerProviderProps> = ({
    children,
}) => {
    const webviewState = useVscodeWebview<
        SchemaDesignerWebviewState,
        SchemaDesignerReducers
    >();

    const saveAs = (
        format: "svg" | "png" | "jpg",
        svgFileContents: string,
        width: number,
        height: number,
    ) => {
        void webviewState.extensionRpc.action("saveAs", {
            format,
            svgFileContents,
            width,
            height,
        });
    };

    return (
        <SchemaDesignerContext.Provider
            value={{
                ...getCoreRPCs(webviewState),
                extensionRpc: webviewState.extensionRpc,
                schema: webviewState.state.schema,
                state: webviewState.state,
                themeKind: webviewState.themeKind,
                saveAs,
            }}
        >
            {children}
        </SchemaDesignerContext.Provider>
    );
};

export { SchemaDesignerContext, SchemaDesignerStateProvider };
