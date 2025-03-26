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

import {
    Edge,
    Node,
    OnEdgesChange,
    OnNodesChange,
    useReactFlow,
} from "@xyflow/react";
import {
    extractSchemaModel,
    generateSchemaDesignerFlowComponents,
} from "./schemaDesignerUtils";

export interface SchemaDesignerContextProps
    extends WebviewContextProps<SchemaDesigner.SchemaDesignerWebviewState> {
    extensionRpc: WebviewRpc<SchemaDesigner.SchemaDesignerReducers>;
    getScript: () => Promise<string>;
    initializeSchemaDesigner: () => Promise<{
        nodes: Node<SchemaDesigner.Table>[];
        edges: Edge<SchemaDesigner.ForeignKey>[];
    }>;
    saveAsFile: (fileProps: SchemaDesigner.ExportFileOptions) => void;

    selectedTable: SchemaDesigner.Table;
    setSelectedTable: (selectedTable: SchemaDesigner.Table) => void;
    isEditDrawerOpen: boolean;
    setIsEditDrawerOpen: (isEditDrawerOpen: boolean) => void;
    isPublishChangesEnabled: boolean;
    setIsPublishChangesEnabled: (isPublishChangesEnabled: boolean) => void;
    getReport: () => void;
    copyToClipboard: (text: string) => void;
    openInEditor: (text: string) => void;
    openInEditorWithConnection: (text: string) => void;
    script: SchemaDesigner.GenerateScriptResponse;
    schemaNames: string[];
    datatypes: string[];
    report: SchemaDesigner.GetReportResponse;
    showError: (message: string) => void;
    selectedReportTab: string;
    setSelectedReportTab: (selectedReportTab: string) => void;
    editTable: (table: SchemaDesigner.Table) => Promise<SchemaDesigner.Table>;
    onNodesChange: OnNodesChange<Node<SchemaDesigner.Table>>;
    onEdgesChange: OnEdgesChange<Edge<SchemaDesigner.ForeignKey>>;
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
    const [isPublishChangesEnabled, setIsPublishChangesEnabled] =
        useState(false);

    const [selectedReportTab, setSelectedReportTab] =
        useState<string>("report");

    // Reducer callers
    const saveAsFile = (fileProps: SchemaDesigner.ExportFileOptions) => {
        void extensionRpc.call("exportToFile", {
            ...fileProps,
        });
    };

    const [script, setScript] = useState<SchemaDesigner.GenerateScriptResponse>(
        {
            combinedScript: "",
            scripts: [],
        },
    );

    const [report, setReport] = useState<SchemaDesigner.GetReportResponse>({
        reports: [],
        updateScript: "",
    });

    extensionRpc.subscribe(
        "schemaDesignerStateProvider",
        "isModelReady",
        (payload: unknown) => {
            const typedPayload = payload as {
                isModelReady: boolean;
            };
            setIsPublishChangesEnabled(typedPayload.isModelReady);
        },
    );

    const getReport = async () => {
        if (schemaDesigner) {
            const report = (await extensionRpc.call("getReport", {
                updatedSchema: schemaDesigner.schema,
            })) as SchemaDesigner.GetReportResponse;
            setReport(report);
        }
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
                getScript,
                initializeSchemaDesigner,
                saveAsFile,

                selectedTable,
                setSelectedTable,
                isEditDrawerOpen,
                setIsEditDrawerOpen,
                isPublishChangesEnabled,
                setIsPublishChangesEnabled,
                getReport,
                copyToClipboard,
                openInEditor,
                openInEditorWithConnection,
                script,
                schemaNames,
                datatypes,
                report,
                showError,
                selectedReportTab,
                setSelectedReportTab,
            }}
        >
            {children}
        </SchemaDesignerContext.Provider>
    );
};

export { SchemaDesignerContext, SchemaDesignerStateProvider };
