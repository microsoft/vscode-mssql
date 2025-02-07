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

    const graphContainerRef = useRef<HTMLDivElement | undefined>(undefined);
    const editorDivRef = useRef<HTMLDivElement | undefined>(undefined);

    useEffect(() => {
        const editorDiv = editorDivRef.current;
        function updateEditorPosition(x: number, y: number, scale: number) {
            editorDiv.style.transform = `scale(${scale})`;
            editorDiv.style.top = `${y}px`;
            editorDiv.style.left = `${x}px`;
        }
        function createGraph() {
            let currentCell = {
                x: 0,
                y: 0,
                scale: 1,
                cell: undefined as mxCell,
            };
            const div = graphContainerRef.current;
            if (!div) {
                return;
            }
            div.innerHTML = "";
            const schemaDesignerConfig = config;

            schemaDesignerConfig.editEntity = (
                cell,
                _x,
                _y,
                _scale,
                _incomingEdges,
                outgoingEdges,
                _model,
            ) => {
                currentCell = {
                    x: _x,
                    y: _y,
                    scale: _scale,
                    cell: cell,
                };
                setDisplayEditor(true);
                updateEditorPosition(
                    _x - div.scrollLeft,
                    _y - div.scrollTop,
                    _scale,
                );
                setEntity(cell.value as IEntity);
                return {
                    editedEntity: cell.value as IEntity,
                    editedOutgoingEdges: outgoingEdges.map(
                        (edge) => edge.value as IRelationship,
                    ),
                };
            };

            schemaDesignerConfig.editRelationship = (cell, _x, _y, _scale) => {
                return cell.value as IRelationship;
            };

            schemaDesignerConfig.updateEditorPosition = (_x, _y, _scale) => {
                currentCell.x = _x;
                currentCell.y = _y;
                currentCell.scale = _scale;
                updateEditorPosition(
                    _x - div.scrollLeft,
                    _y - div.scrollTop,
                    graph._graph.view.scale,
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
            graph.renderModel(context!.schema, true);
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
                id="editor"
                ref={editorDivRef}
                style={{
                    width: "400px",
                    height: "400px",
                    position: "absolute",
                    display: displayEditor ? "block" : "none",
                    backgroundColor: "white",
                    color: "black",
                    zIndex: 2,
                    transformOrigin: "top left",
                }}
            >
                <SchemaDesignerEntityEditor entity={entity!} />
            </div>
        </div>
    );
};
