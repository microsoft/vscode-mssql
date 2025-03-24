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
    copyToClipboard: (text: string) => void;
    openInEditor: (text: string) => void;
    openInEditorWithConnection: (text: string) => void;
    script: SchemaDesigner.GenerateScriptResponse;
    schemaNames: string[];
    datatypes: string[];
    initializeSchemaDesigner: () => void;
    report: SchemaDesigner.GetReportResponse;
    showError: (message: string) => void;
    selectedReportTab: string;
    setSelectedReportTab: (selectedReportTab: string) => void;
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
    const [datatypes, setDatatypes] = useState<string[]>([]);
    const [schemaNames, setSchemaNames] = useState<string[]>([]);
    const [schema, setSchema] = useState<SchemaDesigner.Schema>({
        tables: [],
    });

    const [selectedTable, setSelectedTable] = useState<
        SchemaDesigner.Table | undefined
    >(undefined);

    const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
    const [isCodeDrawerOpen, setIsCodeDrawerOpen] = useState(false);
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

    const getScript = async () => {
        if (schemaDesigner) {
            const script = (await extensionRpc.call("getScript", {
                updatedSchema: schemaDesigner.schema,
            })) as SchemaDesigner.GenerateScriptResponse;
            setScript(script);
        }
    };

    useEffect(() => {
        if (schemaDesigner) {
            void initializeSchemaDesigner();
        }
    }, [schemaDesigner]);

    useEffect(() => {
        void initializeSchemaDesigner();
    }, []);

    const initializeSchemaDesigner = async () => {
        // if (schemaDesigner) {
        const model = (await extensionRpc.call(
            "initializeSchemaDesigner",
        )) as SchemaDesigner.CreateSessionResponse;
        setSchema(model.schema);
        setDatatypes(model.dataTypes);
        setSchemaNames(model.schemaNames);
        // }
    };

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
                copyToClipboard,
                openInEditor,
                openInEditorWithConnection,
                script,
                schemaNames,
                datatypes,
                initializeSchemaDesigner,
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
