/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
import { useContext, useEffect, useRef } from "react";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import {
    schemaDesignerConfig,
    getSchemaDesignerColors,
    isForeignKeyValid,
} from "./schemaDesignerUtils";
import * as azdataGraph from "azdataGraph";

// Import styles
import "azdataGraph/dist/index.css";
import "azdataGraph/src/css/common.css";
import "azdataGraph/src/css/explorer.css";
import "./schemaDesigner.css";

// Set the global mxLoadResources to false to prevent mxgraph from loading resources
window["mxLoadResources"] = false;

export const SchemaDiagramGraph = () => {
    const context = useContext(SchemaDesignerContext);
    const graphContainerRef = useRef<HTMLDivElement | null>(null);
    const toasterId = useId("toaster");
    const { dispatchToast } = useToastController(toasterId);

    const errorNotification = (errorMessage: string | undefined) => {
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
        return null;
    }

    // Handles theme changes
    useEffect(() => {
        const themeChangeHandler = () => {
            if (context.schemaDesigner) {
                context.schemaDesigner.applyColors(getSchemaDesignerColors());
            }
        };

        context.extensionRpc.subscribe(
            "schemaDesigner",
            "onDidChangeTheme",
            themeChangeHandler,
        );
    }, [context.schemaDesigner, context.extensionRpc]);

    // Initialize the graph
    useEffect(() => {
        const initializeGraph = () => {
            const container = graphContainerRef.current;
            if (!container) {
                return;
            }

            // Clear existing content
            container.innerHTML = "";

            // Configure graph
            const config = schemaDesignerConfig;
            config.editTable = async (table, _cell, _x, _y, _scale, _model) => {
                context.setIsEditDrawerOpen(true);
                context.setSelectedTable(table);
                context.getScript();
            };

            // Create new graph
            const graph = new azdataGraph.SchemaDesigner(container, config);
            context.setSchemaDesigner(graph);
        };

        initializeGraph();
    }, []);

    // Handle schema changes and setup event listeners
    useEffect(() => {
        if (!context.schemaDesigner || !context.schema) {
            return;
        }

        // Allow all foreign keys initially (validation happens on cell add)
        context.schemaDesigner.isForeignKeyValid = () => true;

        // Render the schema
        context.schemaDesigner.renderSchema(context.schema, true);

        // Set up cell added event listener
        const handleCellsAdded = (_event: any, eventData: any) => {
            const addedCell = eventData.properties
                .cells[0] as azdataGraph.mxCell;

            // Only process edges (foreign key relationships)
            if (addedCell.isEdge()) {
                validateAndProcessNewForeignKey(addedCell);
            }

            // Update script
            context.getScript();
        };

        // Validate and process a new foreign key
        const validateAndProcessNewForeignKey = (edge: azdataGraph.mxCell) => {
            const schema = context.schemaDesigner?.schema;
            if (!schema) return;

            // Find the tables involved in the relationship
            const sourceTable = schema.tables.find(
                (table) => table.id === edge.source.value.id,
            );
            const targetTable = schema.tables.find(
                (table) => table.id === edge.target.value.id,
            );

            if (!sourceTable || !targetTable) {
                console.log("Invalid source or target table");
                return;
            }

            // Get the columns involved
            const sourceColumnName =
                sourceTable.columns[edge.value.sourceRow - 1]?.name;
            const targetColumnName =
                targetTable.columns[edge.value.targetRow - 1]?.name;

            if (!sourceColumnName || !targetColumnName) {
                console.log("Invalid source or target column");
                return;
            }

            // Validate the foreign key
            const validationResult = isForeignKeyValid(
                schema.tables,
                sourceTable,
                edge.value as SchemaDesigner.ForeignKey,
            );

            // Handle invalid foreign key
            if (!validationResult.isValid) {
                // Remove the invalid relationship
                context.schemaDesigner?.mxGraph.removeCells([edge]);

                // Show error notification
                errorNotification(validationResult.errorMessage ?? "");
            }
        };

        // Add the event listener
        context.schemaDesigner.mxGraph.addListener(
            azdataGraph.mxGraphFactory.mxEvent.CELLS_ADDED,
            handleCellsAdded,
        );
    }, [context.schema]);

    return (
        <>
            <Toaster toasterId={toasterId} />
            <div id="graphContainer" ref={graphContainerRef}></div>
        </>
    );
};
