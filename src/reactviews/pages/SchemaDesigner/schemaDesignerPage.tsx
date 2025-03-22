/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useRef } from "react";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import * as azdataGraph from "azdataGraph";
import "azdataGraph/dist/index.css";
import "azdataGraph/src/css/common.css";
import "azdataGraph/src/css/explorer.css";
import "./schemaDesigner.css";
import {
    config,
    getSchemaDesignerColors,
    isForeignKeyValid,
} from "./schemaDesignerUtils";
import { SchemaDesignerToolbar } from "./toolbar/schemaDesignerToolbar";
import { SchemaDiagramZoomControls } from "./schemaDiagramZoomControls";
import { SchemaDesignerEditorDrawer } from "./editor/schemaDesignerEditorDrawer";
import { SchemaDesignerCodeDrawer } from "./schemaDesignerCodeDrawer";
import {
    Link,
    Toast,
    ToastBody,
    Toaster,
    ToastTitle,
    ToastTrigger,
    useId,
    useToastController,
} from "@fluentui/react-components";
import { locConstants } from "../../common/locConstants";

// Set the global mxLoadResources to false to prevent mxgraph from loading resources
window["mxLoadResources"] = false;

export const SchemaDesignerPage = () => {
    const context = useContext(SchemaDesignerContext);
    const toasterId = useId("toaster");
    const { dispatchToast } = useToastController(toasterId);
    const foreignKeyNotification = (errorMessage: string | undefined) => {
        console.log("Foreign key error: ", errorMessage);
        dispatchToast(
            <Toast>
                <ToastTitle
                    action={
                        <ToastTrigger>
                            <Link>Dismiss</Link>
                        </ToastTrigger>
                    }
                >
                    {locConstants.schemaDesigner.foreignKeyError}
                </ToastTitle>
                <ToastBody subtitle={errorMessage}></ToastBody>
            </Toast>,
            { intent: "error", timeout: 999999 },
        );
    };

    if (!context) {
        return undefined;
    }

    const graphContainerRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        context.extensionRpc.subscribe(
            "schemaDesigner",
            "onDidChangeTheme",
            (_params) => {
                if (context.schemaDesigner) {
                    context.schemaDesigner.applyColors(
                        getSchemaDesignerColors(),
                    );
                }
            },
        );
    }, [context.schemaDesigner]);

    useEffect(() => {
        function createGraph() {
            const div = graphContainerRef.current;
            if (!div) {
                return;
            }
            div.innerHTML = "";
            const schemaDesignerConfig = config;
            schemaDesignerConfig.editTable = async (
                table,
                _cell,
                _x,
                _y,
                _scale,
                _model,
            ) => {
                context.setIsEditDrawerOpen(true);
                context.setSelectedTable(table);
                context.getScript();
            };
            const graph = new azdataGraph.SchemaDesigner(
                div,
                schemaDesignerConfig,
            );
            context?.setSchemaDesigner(graph);
        }
        createGraph();
    }, []);

    useEffect(() => {
        if (context.schemaDesigner) {
            context.schemaDesigner.isForeignKeyValid = (
                _source: azdataGraph.mxCell,
                _target: azdataGraph.mxCell,
                _sourceColumn: number,
                _targetColumn: number,
            ): boolean => {
                return true;
            };

            context.schemaDesigner.renderSchema(context.schema, true);
            context.schemaDesigner.mxGraph.addListener(
                azdataGraph.mxGraphFactory.mxEvent.CELLS_ADDED,
                (_event, _target) => {
                    const target = _target.properties
                        .cells[0] as azdataGraph.mxCell;
                    if (target.isEdge()) {
                        const schema = context.schemaDesigner?.schema;
                        const sourceTable = schema?.tables.find(
                            (table) => table.id === target.source.value.id,
                        );
                        const targetTable = schema?.tables.find(
                            (table) => table.id === target.target.value.id,
                        );
                        if (!sourceTable || !targetTable) {
                            console.log("Invalid source or target table");
                            return;
                        }
                        const sourceColumnName =
                            sourceTable?.columns[target.value.sourceRow - 1]
                                ?.name;
                        const targetColumnName =
                            targetTable?.columns[target.value.targetRow - 1]
                                ?.name;
                        if (!sourceColumnName || !targetColumnName) {
                            console.log(
                                "Invalid source or target table or column",
                            );
                        }
                        const model = context.schemaDesigner?.schema!;
                        const isValid = isForeignKeyValid(
                            model.tables,
                            sourceTable.schema,
                            sourceTable.name,
                            sourceColumnName,
                            targetTable.schema,
                            targetTable.name,
                            targetColumnName,
                        );
                        if (!isValid.isValid) {
                            context.schemaDesigner?.mxGraph.removeCells([
                                target,
                            ]);
                            foreignKeyNotification(isValid.errorMessage);
                            //context.showError(isValid.errorMessage || "");
                        }
                    }
                    context.getScript();
                },
            );
        }
    }, [context.schema]);

    return (
        <>
            <Toaster toasterId={toasterId} />
            <SchemaDesignerEditorDrawer />
            <div
                style={{
                    height: "100%",
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    position: "relative",
                }}
            >
                <div
                    style={{
                        maxHeight: "100%",
                        minHeight: "60%",
                        flex: 1,
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        position: "relative",
                    }}
                >
                    <SchemaDesignerToolbar />
                    <div id="graphContainer" ref={graphContainerRef}></div>
                    <SchemaDiagramZoomControls />
                </div>
                <SchemaDesignerCodeDrawer />
            </div>
        </>
    );
};
