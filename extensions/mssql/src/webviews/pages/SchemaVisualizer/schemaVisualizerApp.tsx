/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Schema Visualizer page (SV-R4). Read-only P0: metadata-backed diagram +
 * honest availability. Data flow:
 *
 *   sv/getModel → projectGraph (pure) → layoutSchemaGraph (pure) →
 *   SchemaGraphCanvas (provider-neutral shell)
 *
 * Honesty rules rendered here (addendum §15):
 * - limited diagram capability → error/limited state, NEVER an empty
 *   canvas presented as an empty database;
 * - stale/partial freshness → visible banner;
 * - large catalogs (searchFirst) → search-first UX, not an unconditional
 *   all-table layout (§11.3);
 * - drift while clean → refresh preserving positions by stable ids (§6.4).
 *
 * Ready semantics (§11.5): `mssql.schemaVisualizer.ready` fires after the
 * expected nodes/edges are committed AND one frame painted
 * (perfMarkAfterNextPaint), with modelReady/layout marks bracketing the
 * phases — the calibrated webview-mark plane carries all three.
 */

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
    Badge,
    Button,
    Input,
    makeStyles,
    MessageBar,
    MessageBarBody,
    Spinner,
    Text,
    tokens,
} from "@fluentui/react-components";
import {
    AddRegular,
    ArrowClockwiseRegular,
    ArrowFlowUpRightRegular,
    SearchRegular,
} from "@fluentui/react-icons";
import { type Edge, type Node, applyNodeChanges } from "@xyflow/react";
import { VscodeWebviewContext } from "../../common/vscodeWebviewProvider";
import { perfMark, perfMarkAfterNextPaintComputed } from "../../common/perfMarks";
import {
    SchemaGraphCanvas,
    SCHEMA_GRAPH_TABLE_NODE_TYPE,
} from "../../common/schemaGraph/SchemaGraphCanvas";
import { SchemaGraphTableData } from "../../common/schemaGraph/schemaGraphTypes";
import { layoutSchemaGraph } from "../../common/schemaGraph/schemaGraphLayout";
import { SchemaVisualizer } from "../../../sharedInterfaces/schemaVisualizer";
import { projectGraph } from "../../../schemaVisualizer/model/visualizerToGraphProjection";
import { SchemaVisualizerProperties } from "./schemaVisualizerProperties";

const useStyles = makeStyles({
    root: {
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
    },
    toolbar: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "8px",
        padding: "6px 8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    body: {
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "row",
    },
    canvas: {
        flex: 1,
        minWidth: 0,
        position: "relative",
    },
    sidebar: {
        width: "320px",
        borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
        overflowY: "auto",
        padding: "8px",
    },
    centered: {
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: "12px",
    },
    searchResults: {
        maxHeight: "40vh",
        overflowY: "auto",
        minWidth: "420px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "4px",
    },
    searchRow: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "4px 8px",
    },
});

type LoadPhase =
    | { phase: "loading" }
    | { phase: "error"; code: string }
    | { phase: "searchFirst"; result: SchemaVisualizer.GetModelResult }
    | { phase: "graph"; result: SchemaVisualizer.GetModelResult };

export const SchemaVisualizerApp = () => {
    const styles = useStyles();
    const webview = useContext(VscodeWebviewContext);
    const rpc = webview!.extensionRpc;
    const [load, setLoad] = useState<LoadPhase>({ phase: "loading" });
    const [nodes, setNodes] = useState<Node<SchemaGraphTableData>[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [selectedTableId, setSelectedTableId] = useState<string | undefined>(undefined);
    const [driftPending, setDriftPending] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchItems, setSearchItems] = useState<
        SchemaVisualizer.SearchTablesResult["items"] | undefined
    >(undefined);
    /** Preserved positions keyed by STABLE node id (§11.3). */
    const positionsRef = useRef(new Map<string, { x: number; y: number }>());
    const renderedRef = useRef<SchemaVisualizer.RenderedParams | undefined>(undefined);
    const currentFilterRef = useRef<number[] | undefined>(undefined);

    const buildGraph = useCallback(
        (result: SchemaVisualizer.GetModelResult, preservePositions: boolean) => {
            const projection = projectGraph(result.model);
            perfMark("mssql.schemaVisualizer.layout.begin", {
                nodeCount: projection.nodes.length,
                edgeCount: projection.edges.length,
            });
            const positions = layoutSchemaGraph(
                projection.nodes.map((node) => ({
                    id: node.id,
                    columnCount: node.columns.length,
                })),
                projection.edges.map((edge) => ({
                    sourceId: edge.sourceNodeId,
                    targetId: edge.targetNodeId,
                })),
            );
            perfMark("mssql.schemaVisualizer.layout.end", {
                nodeCount: projection.nodes.length,
                edgeCount: projection.edges.length,
                layoutMode: "auto",
                canceled: false,
            });
            const nextNodes: Node<SchemaGraphTableData>[] = projection.nodes.map((node) => ({
                id: node.id,
                type: SCHEMA_GRAPH_TABLE_NODE_TYPE,
                position: (preservePositions ? positionsRef.current.get(node.id) : undefined) ??
                    positions.get(node.id) ?? { x: 0, y: 0 },
                data: {
                    id: node.id,
                    schema: node.schema,
                    name: node.name,
                    columns: node.columns,
                },
            }));
            const nextEdges: Edge[] = projection.edges.map((edge) => ({
                id: edge.id,
                source: edge.sourceNodeId,
                target: edge.targetNodeId,
                label: edge.name,
                data: {
                    id: edge.id,
                    name: edge.name,
                    columnPairs: edge.columnPairs,
                    onDeleteLabel: edge.onDeleteLabel,
                    onUpdateLabel: edge.onUpdateLabel,
                },
            }));
            for (const node of nextNodes) {
                positionsRef.current.set(node.id, node.position);
            }
            setNodes(nextNodes);
            setEdges(nextEdges);
            renderedRef.current = {
                renderedTables: nextNodes.length,
                renderedEdges: nextEdges.length,
                totalTables: result.totalTables,
                layoutMode: "auto",
                subsetMode:
                    currentFilterRef.current !== undefined
                        ? "filtered"
                        : result.searchFirst
                          ? "searchFirst"
                          : "all",
            };
            // §11.5 ready: nodes committed + one painted frame.
            perfMarkAfterNextPaintComputed("mssql.schemaVisualizer.ready", () => ({
                renderedTables: nextNodes.length,
                renderedEdges: nextEdges.length,
                totalTables: result.totalTables,
                layoutMode: "auto",
                subsetMode: renderedRef.current?.subsetMode ?? "all",
            }));
            if (renderedRef.current) {
                void rpc.sendNotification(
                    SchemaVisualizer.RenderedNotification.type,
                    renderedRef.current,
                );
            }
        },
        [rpc],
    );

    const requestModel = useCallback(
        async (objectIds: number[] | undefined, options?: { refresh?: boolean }) => {
            setLoad({ phase: "loading" });
            try {
                const params: SchemaVisualizer.GetModelParams =
                    objectIds !== undefined ? { objectIds } : {};
                const result = options?.refresh
                    ? await rpc.sendRequest(SchemaVisualizer.RefreshRequest.type, params)
                    : await rpc.sendRequest(SchemaVisualizer.GetModelRequest.type, params);
                currentFilterRef.current = objectIds;
                perfMark("mssql.schemaVisualizer.modelReady", {
                    tableCount: result.renderedTables,
                });
                setDriftPending(false);
                if (result.searchFirst && objectIds === undefined) {
                    setLoad({ phase: "searchFirst", result });
                    setNodes([]);
                    setEdges([]);
                } else {
                    setLoad({ phase: "graph", result });
                    buildGraph(result, !options?.refresh);
                }
            } catch (error) {
                setLoad({
                    phase: "error",
                    code: error instanceof Error ? error.message : "openFailed",
                });
            }
        },
        [buildGraph, rpc],
    );

    useEffect(() => {
        void requestModel(undefined);
        // Page lifetime === webview lifetime: no unsubscription needed.
        rpc.onNotification(
            SchemaVisualizer.ModelChangedNotification.type,
            (params: SchemaVisualizer.ModelChangedParams) => {
                if (params.fingerprintChanged) {
                    setDriftPending(true);
                }
            },
        );
        // Mount-only effect by design: requestModel identity is stable for
        // the page lifetime and the notification handler registers once.
    }, []);

    const runSearch = useCallback(
        async (query: string) => {
            const result = await rpc.sendRequest(SchemaVisualizer.SearchTablesRequest.type, {
                query,
                limit: 200,
            });
            setSearchItems(result.items);
        },
        [rpc],
    );

    const addNeighborhood = useCallback(
        async (objectId: number) => {
            const neighborhood = await rpc.sendRequest(
                SchemaVisualizer.FkNeighborhoodRequest.type,
                { objectIds: [objectId] },
            );
            const next = new Set(currentFilterRef.current ?? []);
            for (const id of neighborhood.objectIds) {
                next.add(id);
            }
            await requestModel([...next]);
        },
        [requestModel, rpc],
    );

    const capabilities =
        load.phase === "graph" || load.phase === "searchFirst"
            ? load.result.model.capabilities
            : undefined;
    const freshness =
        load.phase === "graph" || load.phase === "searchFirst" ? load.result.freshness : undefined;
    const diagramLimited =
        capabilities !== undefined && capabilities.diagramNodes.state !== "available";
    const selectedTable =
        load.phase === "graph" && selectedTableId !== undefined
            ? load.result.model.tables.find((table) => table.graphId === selectedTableId)
            : undefined;

    return (
        <div className={styles.root}>
            <div className={styles.toolbar}>
                <Input
                    contentBefore={<SearchRegular />}
                    placeholder="Search tables"
                    value={searchQuery}
                    onChange={(_e, data) => setSearchQuery(data.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            void runSearch(searchQuery);
                        }
                    }}
                />
                <Button
                    icon={<ArrowClockwiseRegular />}
                    onClick={() => void requestModel(currentFilterRef.current, { refresh: true })}>
                    Refresh
                </Button>
                <Button
                    icon={<ArrowFlowUpRightRegular />}
                    onClick={() => {
                        positionsRef.current.clear();
                        if (load.phase === "graph") {
                            buildGraph(load.result, false);
                        }
                    }}>
                    Arrange
                </Button>
                {freshness !== undefined && freshness.freshness !== "validated" && (
                    <Badge
                        appearance="outline"
                        color={freshness.freshness === "live" ? "success" : "warning"}>
                        {freshness.freshness} ({freshness.source})
                    </Badge>
                )}
                {load.phase === "graph" && (
                    <Text size={200}>
                        {load.result.renderedTables} of {load.result.totalTables} tables
                    </Text>
                )}
            </div>
            {driftPending && (
                <MessageBar intent="info">
                    <MessageBarBody>
                        The database schema changed.{" "}
                        <Button
                            size="small"
                            onClick={() => void requestModel(currentFilterRef.current)}>
                            Refresh diagram
                        </Button>
                    </MessageBarBody>
                </MessageBar>
            )}
            {freshness?.freshness === "stale" && (
                <MessageBar intent="warning">
                    <MessageBarBody>
                        Showing a stale snapshot ({freshness.source}); the live catalog is
                        unavailable. Data may be outdated.
                    </MessageBarBody>
                </MessageBar>
            )}
            {diagramLimited && capabilities && (
                <MessageBar intent="error">
                    <MessageBarBody>
                        The diagram is unavailable:{" "}
                        {capabilities.diagramNodes.state === "limited"
                            ? `metadata section(s) ${capabilities.diagramNodes.failedSections.join(", ")} did not load (${capabilities.diagramNodes.reason}).`
                            : ""}
                        This is a load failure — not an empty database.
                    </MessageBarBody>
                </MessageBar>
            )}
            <div className={styles.body}>
                {load.phase === "loading" && (
                    <div className={styles.centered}>
                        <Spinner label="Loading schema…" />
                    </div>
                )}
                {load.phase === "error" && (
                    <div className={styles.centered}>
                        <MessageBar intent="error">
                            <MessageBarBody>
                                Could not load schema metadata ({load.code}).
                            </MessageBarBody>
                        </MessageBar>
                        <Button onClick={() => void requestModel(undefined)}>Retry</Button>
                    </div>
                )}
                {load.phase === "searchFirst" && (
                    <div className={styles.centered}>
                        <Text weight="semibold">
                            {load.result.totalTables} tables — too many to draw at once.
                        </Text>
                        <Text>Search and add tables to the canvas (FK neighbors come along).</Text>
                        <div>
                            <Input
                                contentBefore={<SearchRegular />}
                                placeholder="Search tables"
                                value={searchQuery}
                                onChange={(_e, data) => {
                                    setSearchQuery(data.value);
                                    void runSearch(data.value);
                                }}
                            />
                        </div>
                        {searchItems !== undefined && (
                            <div className={styles.searchResults}>
                                {searchItems.map((item) => (
                                    <div key={item.objectId} className={styles.searchRow}>
                                        <Text>{`${item.schema}.${item.name}`}</Text>
                                        <Text size={200}>({item.columnCount} columns)</Text>
                                        <Button
                                            size="small"
                                            icon={<AddRegular />}
                                            onClick={() => void addNeighborhood(item.objectId)}>
                                            Add with neighbors
                                        </Button>
                                    </div>
                                ))}
                                {searchItems.length === 0 && (
                                    <div className={styles.searchRow}>
                                        <Text>No matching tables.</Text>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
                {load.phase === "graph" && !diagramLimited && (
                    <>
                        <div className={styles.canvas}>
                            <SchemaGraphCanvas
                                nodes={nodes}
                                edges={edges}
                                onNodesChange={(changes) =>
                                    setNodes((current) => {
                                        const next = applyNodeChanges(changes, current);
                                        for (const node of next) {
                                            positionsRef.current.set(node.id, node.position);
                                        }
                                        return next;
                                    })
                                }
                                onSelectionChange={(selection) => {
                                    setSelectedTableId(selection.nodes[0]?.id);
                                }}
                            />
                        </div>
                        {selectedTable !== undefined && (
                            <div className={styles.sidebar}>
                                <SchemaVisualizerProperties
                                    table={selectedTable}
                                    foreignKeys={load.result.model.foreignKeys.filter(
                                        (fk) =>
                                            fk.fromObjectId === selectedTable.identity.objectId ||
                                            fk.toObjectId === selectedTable.identity.objectId,
                                    )}
                                    capabilities={load.result.model.capabilities}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
