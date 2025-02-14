/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useRef, useState } from "react";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import * as azdataGraph from "azdataGraph";
import "azdataGraph/dist/index.css";
import "azdataGraph/src/css/common.css";
import "azdataGraph/src/css/explorer.css";
import "./schemaDesigner.css";
import {
    IEntity,
    IRelationship,
} from "../../../sharedInterfaces/schemaDesigner";
import { config } from "./schemaDesignerConfig";
import { mxCell } from "mxgraph";
import { SchemaDesignerEntityEditor } from "./schemaDesignerEntityEditor";

// Set the global mxLoadResources to false to prevent mxgraph from loading resources
window["mxLoadResources"] = false;

export const SchemaDesigner = () => {
    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return undefined;
    }

    const [displayEditor, setDisplayEditor] = useState(false);

    const [entity, setEntity] = useState<IEntity | undefined>(undefined);

    const [incomingEdges, setIncomingEdges] = useState<IRelationship[]>([]);
    const [outgoingEdges, setOutgoingEdges] = useState<IRelationship[]>([]);

    const graphContainerRef = useRef<HTMLDivElement | null>(null);
    const editorDivRef = useRef<HTMLDivElement | null>(null);

    const [schemaDesigner, setSchemaDesigner] = useState<
        azdataGraph.SchemaDesigner | undefined
    >(undefined);

    useEffect(() => {
        const editorDiv = editorDivRef.current;
        function updateEditorPosition(x: number, y: number, scale: number) {
            if (!editorDiv) {
                return;
            }
            editorDiv.style.transform = `scale(${scale})`;
            editorDiv.style.top = `${y}px`;
            editorDiv.style.left = `${x}px`;
        }
        function createGraph() {
            let currentCell = {
                x: 0,
                y: 0,
                scale: 1,
                height: 0,
                cell: undefined! as mxCell,
            };
            const div = graphContainerRef.current;
            if (!div) {
                return;
            }
            div.innerHTML = "";
            const schemaDesignerConfig = config;
            schemaDesignerConfig.editEntity = async (
                cell,
                x,
                y,
                scale,
                incomingEdges,
                outgoingEdges,
                _model,
            ) => {
                const cellPosition = calculateEditorPosition(
                    x,
                    y,
                    cell.geometry.height,
                    scale,
                    div.scrollHeight,
                );
                currentCell = {
                    x: cellPosition.x,
                    y: cellPosition.y,
                    scale: scale,
                    cell: cell,
                    height: cell.geometry.height,
                };

                setDisplayEditor(true);

                updateEditorPosition(
                    currentCell.x - div.scrollLeft,
                    currentCell.y - div.scrollTop,
                    scale,
                );

                setEntity(cell.value as IEntity);

                setOutgoingEdges(
                    outgoingEdges.map((edge) => edge.value as IRelationship),
                );
                setIncomingEdges(
                    incomingEdges.map((edge) => edge.value as IRelationship),
                );
            };

            schemaDesignerConfig.editRelationship = (cell, _x, _y, _scale) => {
                return cell.value as IRelationship;
            };

            schemaDesignerConfig.updateEditorPosition = (x, y, scale) => {
                const cellPosition = calculateEditorPosition(
                    x,
                    y,
                    currentCell.height,
                    scale,
                    div.scrollHeight,
                );
                currentCell.x = cellPosition.x;
                currentCell.y = cellPosition.y;
                currentCell.scale = scale;

                updateEditorPosition(
                    x - div.scrollLeft,
                    y - div.scrollTop,
                    graph.mxGraph.view.scale,
                );
            };

            const graph = new azdataGraph.SchemaDesigner(
                div,
                schemaDesignerConfig,
            );

            div.addEventListener("scroll", (_evt) => {
                updateEditorPosition(
                    currentCell.x - div.scrollLeft,
                    currentCell.y - div.scrollTop,
                    currentCell.scale,
                );
            });
            graph.renderSchema(context!.schema, true);
            setSchemaDesigner(graph);
        }
        createGraph();
    }, [context.schema]);

    return (
        <div
            style={{
                height: "100%",
                width: "100%",
                position: "relative",
            }}
        >
            <div id="graphContainer" ref={graphContainerRef}></div>
            <div
                className="sd-editor"
                ref={editorDivRef}
                style={{
                    display: displayEditor ? "block" : "none",
                }}
            >
                <SchemaDesignerEntityEditor
                    entity={entity!}
                    schema={context.schema}
                    incomingEdges={incomingEdges}
                    outgoingEdges={outgoingEdges}
                    schemaDesigner={schemaDesigner}
                    onClose={() => setDisplayEditor(false)}
                />
            </div>
        </div>
    );
};

function calculateEditorPosition(
    cellX: number,
    cellY: number,
    cellHeight: number,
    mxGraphScale: number,
    mxGraphDivScrollHeight: number,
) {
    const EDITOR_HEIGHT = 400;
    const x = cellX - 3 * mxGraphScale; // Make sure the editor doesn't go off the left side of the cell
    const y = cellY + ((cellHeight - EDITOR_HEIGHT) * mxGraphScale) / 2; // Center the editor vertically in the cell
    const minY = 10 * mxGraphScale; // Make sure the editor doesn't go off the top of the graph div
    const maxY = mxGraphDivScrollHeight - (EDITOR_HEIGHT + 20) * mxGraphScale; // Make sure the editor doesn't go off the bottom of the graph div
    return {
        x: x,
        y: Math.min(Math.max(y, minY), maxY),
    };
}
