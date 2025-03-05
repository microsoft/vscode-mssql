/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useEffect, useState } from "react";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import {
    useVscodeWebview,
    WebviewContextProps,
} from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";
import { WebviewRpc } from "../../common/rpc";
import * as azdataGraph from "azdataGraph";

export interface SchemaDesignerContextProps
    extends WebviewContextProps<SchemaDesigner.SchemaDesignerWebviewState> {
    extensionRpc: WebviewRpc<SchemaDesigner.SchemaDesignerReducers>;
    saveAsFile: (fileProps: SchemaDesigner.ExportFileOptions) => void;
    schemaDesigner: azdataGraph.SchemaDesigner | undefined;
    setSchemaDesigner: (schemaDesigner: azdataGraph.SchemaDesigner) => void;
    schema: SchemaDesigner.Schema;
    setSchema: (schema: SchemaDesigner.Schema) => void;
    selectedTable: SchemaDesigner.Table;
    setSelectedTable: (selectedTable: SchemaDesigner.Table) => void;
    isEditDrawerOpen: boolean;
    setIsEditDrawerOpen: (isEditDrawerOpen: boolean) => void;
    isPublishChangesEnabled: boolean;
    setIsPublishChangesEnabled: (isPublishChangesEnabled: boolean) => void;
    setIsCodeDrawerOpen: (isCodeDrawerOpen: boolean) => void;
    isCodeDrawerOpen: boolean;
    getScript: () => void;
    getReport: () => void;
}

const SchemaDesignerContext = createContext<SchemaDesignerContextProps>(
    undefined as unknown as SchemaDesignerContextProps,
);

interface SchemaDesignerProviderProps {
    children: React.ReactNode;
}

const SchemaDesignerStateProvider: React.FC<SchemaDesignerProviderProps> = ({
    children,
}) => {
    const webviewContext = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();
    const { state, extensionRpc, themeKind } = webviewContext;

    const [schemaDesigner, setSchemaDesigner] = useState<
        azdataGraph.SchemaDesigner | undefined
    >(undefined);
    const [schema, setSchema] = useState<SchemaDesigner.Schema>(state.schema);

    const [selectedTable, setSelectedTable] = useState<
        SchemaDesigner.Table | undefined
    >(undefined);

    const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
    const [isCodeDrawerOpen, setIsCodeDrawerOpen] = useState(false);

    const [isPublishChangesEnabled, setIsPublishChangesEnabled] =
        useState(false);

    useEffect(() => {
        setIsPublishChangesEnabled(webviewContext.state.isModelReady);
    }, [webviewContext.state.isModelReady]);

    // Reducer callers
    const saveAsFile = (fileProps: SchemaDesigner.ExportFileOptions) => {
        void extensionRpc.action("exportToFile", {
            ...fileProps,
        });
    };
    const getScript = () => {
        if (schemaDesigner) {
            void extensionRpc.action("getScript", {
                updatedSchema: schemaDesigner.schema,
            });
        }
    };
    const getReport = () => {
        if (schemaDesigner) {
            void extensionRpc.action("getReport", {
                updatedSchema: schemaDesigner.schema,
            });
        }
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
                selectedTable,
                setSelectedTable,
                isEditDrawerOpen,
                setIsEditDrawerOpen,
                isPublishChangesEnabled,
                setIsPublishChangesEnabled,
                isCodeDrawerOpen,
                setIsCodeDrawerOpen,
                getScript,
                getReport,
            }}
        >
            {children}
        </SchemaDesignerContext.Provider>
    );
};

export { SchemaDesignerContext, SchemaDesignerStateProvider };
