/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useState } from "react";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import {
    useVscodeWebview,
    WebviewContextProps,
} from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";
import { WebviewRpc } from "../../common/rpc";

import { Edge, Node, useReactFlow } from "@xyflow/react";
import {
    extractSchemaModel,
    generateSchemaDesignerFlowComponents,
} from "./schemaDesignerUtils";

export interface SchemaDesignerContextProps
    extends WebviewContextProps<SchemaDesigner.SchemaDesignerWebviewState> {
    extensionRpc: WebviewRpc<SchemaDesigner.SchemaDesignerReducers>;
    schemaNames: string[];
    datatypes: string[];
    getScript: () => Promise<string>;
    initializeSchemaDesigner: () => Promise<{
        nodes: Node<SchemaDesigner.Table>[];
        edges: Edge<SchemaDesigner.ForeignKey>[];
    }>;
    saveAsFile: (fileProps: SchemaDesigner.ExportFileOptions) => void;
    getReport: () => Promise<SchemaDesigner.GetReportResponse>;
    openInEditor: (text: string) => void;
    openInEditorWithConnection: (text: string) => void;

    selectedTable: SchemaDesigner.Table;
    setSelectedTable: (selectedTable: SchemaDesigner.Table) => void;
    copyToClipboard: (text: string) => void;

    showError: (message: string) => void;
    editTable: (table: SchemaDesigner.Table) => Promise<SchemaDesigner.Table>;
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
    // Set up necessary webview context
    const webviewContext = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();
    const { state, extensionRpc, themeKind } = webviewContext;

    // Setups for schema designer model
    const [datatypes, setDatatypes] = useState<string[]>([]);
    const [schemaNames, setSchemaNames] = useState<string[]>([]);

    const initializeSchemaDesigner = async () => {
        const model = (await extensionRpc.call(
            "initializeSchemaDesigner",
        )) as SchemaDesigner.CreateSessionResponse;

        const { nodes, edges } = generateSchemaDesignerFlowComponents(
            model.schema,
        );

        setDatatypes(model.dataTypes);
        setSchemaNames(model.schemaNames);

        return {
            nodes,
            edges,
        };
    };

    const reactFlow = useReactFlow();

    // Table under edit
    const [selectedTable, setSelectedTable] = useState<
        SchemaDesigner.Table | undefined
    >(undefined);

    // Get the script from the server
    const getScript = async () => {
        const schema = extractSchemaModel(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
        );
        const script = (await extensionRpc.call("getScript", {
            updatedSchema: schema,
        })) as SchemaDesigner.GenerateScriptResponse;
        return script.combinedScript;
    };

    const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);

    // Reducer callers
    const saveAsFile = (fileProps: SchemaDesigner.ExportFileOptions) => {
        void extensionRpc.call("exportToFile", {
            ...fileProps,
        });
    };

    const getReport = async () => {
        const schema = extractSchemaModel(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
        );
        if (!schema) {
            return;
        }

        const report = (await extensionRpc.call("getReport", {
            updatedSchema: schema,
        })) as SchemaDesigner.GetReportResponse;

        return report;
    };

    const copyToClipboard = (text: string) => {
        void extensionRpc.call("copyToClipboard", {
            text: text,
        });
    };

    const openInEditor = (text: string) => {
        void extensionRpc.call("openInEditor", {
            text: text,
        });
    };

    const openInEditorWithConnection = (text: string) => {
        void extensionRpc.call("openInEditorWithConnection", {
            text: text,
        });
    };

    const showError = (message: string) => {
        void extensionRpc.call("showError", {
            message: message,
        });
    };

    return (
        <SchemaDesignerContext.Provider
            value={{
                ...getCoreRPCs(webviewContext),
                extensionRpc: extensionRpc,
                state: state,
                themeKind: themeKind,
                schemaNames,
                datatypes,
                getScript,
                initializeSchemaDesigner,
                saveAsFile,
                getReport,
                openInEditor,
                openInEditorWithConnection,
                copyToClipboard,

                selectedTable,
                setSelectedTable,
                isEditDrawerOpen,
                setIsEditDrawerOpen,

                showError,
            }}
        >
            {children}
        </SchemaDesignerContext.Provider>
    );
};

export { SchemaDesignerContext, SchemaDesignerStateProvider };
