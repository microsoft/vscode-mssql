/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useState } from "react";
import {
    ISchema,
    SaveAsFileProps,
    SchemaDesignerReducers,
    SchemaDesignerWebviewState,
} from "../../../sharedInterfaces/schemaDesigner";
import {
    useVscodeWebview,
    WebviewContextProps,
} from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";
import { WebviewRpc } from "../../common/rpc";
import * as azdataGraph from "azdataGraph";

export interface SchemaDesignerContextProps
    extends WebviewContextProps<SchemaDesignerWebviewState> {
    extensionRpc: WebviewRpc<SchemaDesignerReducers>;
    saveAsFile: (fileProps: SaveAsFileProps) => void;
    schemaDesigner: azdataGraph.SchemaDesigner | undefined;
    setSchemaDesigner: (schemaDesigner: azdataGraph.SchemaDesigner) => void;
    schema: ISchema;
    setSchema: (schema: ISchema) => void;
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
    const webviewContext = useVscodeWebview<
        SchemaDesignerWebviewState,
        SchemaDesignerReducers
    >();
    const { state, extensionRpc, themeKind } = webviewContext;

    const [schemaDesigner, setSchemaDesigner] = useState<
        azdataGraph.SchemaDesigner | undefined
    >(undefined);
    const [schema, setSchema] = useState<ISchema>(state.schema);

    // Reducer methods
    const saveAsFile = (fileProps: SaveAsFileProps) => {
        void extensionRpc.action("saveAsFile", {
            ...fileProps,
        });
    };

    return (
        <SchemaDesignerContext.Provider
            value={{
                ...getCoreRPCs(webviewContext),
                extensionRpc: extensionRpc,
                state: state,
                themeKind: themeKind,
                saveAsFile,
                schemaDesigner,
                setSchemaDesigner,
                schema,
                setSchema,
            }}
        >
            {children}
        </SchemaDesignerContext.Provider>
    );
};

export { SchemaDesignerContext, SchemaDesignerStateProvider };
