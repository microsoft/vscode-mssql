/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Schema Visualizer page (SV-R4 read surface + SV-R8c edit capture).
 * Data flow:
 *
 *   sv/getModel → projectGraph (pure) → layoutSchemaGraph (pure) →
 *   SchemaGraphCanvas (provider-neutral shell)
 *
 * Edit mode (SV-R8c): the op LOG is the edit authority (§7.2) — the canvas
 * re-projects the reduced model (projectEditableGraph) so edits render
 * live; undo/redo moves a cursor over the log; Apply Changes previews via
 * the v1 handoff machine (sv/previewChanges — classic session created at
 * command time, D3) and publishes a preview token (§8.4).
 *
 * Honesty rules rendered here (addendum §15):
 * - limited diagram capability → error/limited state, NEVER an empty
 *   canvas presented as an empty database;
 * - stale/partial freshness → visible banner;
 * - large catalogs (searchFirst) → search-first UX, not an unconditional
 *   all-table layout (§11.3);
 * - drift while clean → refresh preserving positions by stable ids (§6.4);
 * - drift while DIRTY → banner offering Rebase (client-side replay with
 *   per-op conflicts, §7.5 — never silently) or Discard.
 *
 * Ready semantics (§11.5): `mssql.schemaVisualizer.ready` fires after the
 * expected nodes/edges are committed AND one frame painted
 * (perfMarkAfterNextPaint), with modelReady/layout marks bracketing the
 * phases — the calibrated webview-mark plane carries all three.
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    Badge,
    Button,
    Checkbox,
    Input,
    makeStyles,
    MessageBar,
    MessageBarBody,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Select,
    Spinner,
    Text,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    tokens,
} from "@fluentui/react-components";
import {
    AddRegular,
    ArrowClockwiseRegular,
    ArrowFlowUpRightRegular,
    ArrowRedoRegular,
    ArrowUndoRegular,
    DatabaseArrowUpRegular,
    DeleteRegular,
    EditRegular,
    FilterRegular,
    SearchRegular,
    TableAddRegular,
} from "@fluentui/react-icons";
import { type Edge, type Node, applyNodeChanges } from "@xyflow/react";
import { VscodeWebviewContext } from "../../common/vscodeWebviewProvider";
import { locConstants } from "../../common/locConstants";
import { perfMark, perfMarkAfterNextPaintComputed } from "../../common/perfMarks";
import {
    SchemaGraphCanvas,
    SCHEMA_GRAPH_TABLE_NODE_TYPE,
} from "../../common/schemaGraph/SchemaGraphCanvas";
import { SchemaGraphTableData } from "../../common/schemaGraph/schemaGraphTypes";
import { layoutSchemaGraph } from "../../common/schemaGraph/schemaGraphLayout";
import { SchemaVisualizer } from "../../../sharedInterfaces/schemaVisualizer";
import {
    projectGraph,
    SchemaGraphProjection,
} from "../../../schemaVisualizer/model/visualizerToGraphProjection";
import {
    collectGraphEditStates,
    projectEditableGraph,
} from "../../../schemaVisualizer/model/projectEditableGraph";
import {
    EditableModel,
    EditableTable,
    applyEdit,
    buildEditableModel,
    normalizeOperations,
    rebaseOperations,
} from "../../../schemaVisualizer/model/schemaVisualizerEditReducer";
import { FkReferentialActionValues, SchemaVisualizerEditOp } from "./schemaVisualizerEditShared";
import { SchemaVisualizerProperties } from "./schemaVisualizerProperties";
import { SchemaVisualizerTableEditor, TableEditorMode } from "./schemaVisualizerTableEditor";
import { SchemaVisualizerPublishDialog } from "./schemaVisualizerPublishDialog";

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
        gap: "4px",
        padding: "2px 8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        flexWrap: "wrap",
    },
    toolbarSpacer: {
        flex: 1,
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
        display: "flex",
        flexDirection: "column",
        gap: "8px",
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
    filterList: {
        maxHeight: "40vh",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        minWidth: "260px",
    },
    filterActions: {
        display: "flex",
        gap: "8px",
        paddingTop: "8px",
    },
    fkEditRow: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        paddingTop: "6px",
    },
    fkActionRow: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
    },
    searchInput: {
        minWidth: "180px",
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
    const [filterOpen, setFilterOpen] = useState(false);
    const [filterDraft, setFilterDraft] = useState<Set<number>>(new Set());
    // -- edit state (SV-R8c): ops + cursor are the ONLY edit authority.
    const [ops, setOps] = useState<SchemaVisualizerEditOp[]>([]);
    const [cursor, setCursor] = useState(0);
    const [editError, setEditError] = useState<string | undefined>(undefined);
    const [editorMode, setEditorMode] = useState<TableEditorMode | undefined>(undefined);
    const [publishOpen, setPublishOpen] = useState(false);
    const [publishNotice, setPublishNotice] = useState<
        { kind: "success" | "refreshFailed" } | undefined
    >(undefined);
    /** Preserved positions keyed by STABLE node id (§11.3). */
    const positionsRef = useRef(new Map<string, { x: number; y: number }>());
    const renderedRef = useRef<SchemaVisualizer.RenderedParams | undefined>(undefined);
    const currentFilterRef = useRef<number[] | undefined>(undefined);
    const editRevisionRef = useRef(0);

    const activeOps = useMemo(() => ops.slice(0, cursor), [ops, cursor]);
    const dirty = activeOps.length > 0;

    const baselineModel = load.phase === "graph" ? load.result.model : undefined;

    /** Reduced model = baseline + active ops (pure replay; ops pre-validated). */
    const editedModel: EditableModel | undefined = useMemo(() => {
        if (baselineModel === undefined) {
            return undefined;
        }
        let model = buildEditableModel(baselineModel);
        for (const op of activeOps) {
            const result = applyEdit(model, op);
            if (result.ok === false) {
                // Ops are validated at capture; a replay conflict means the
                // baseline moved under us — the drift banner owns recovery.
                return model;
            }
            model = result.model;
        }
        return model;
    }, [baselineModel, activeOps]);

    const editStates = useMemo(() => collectGraphEditStates(activeOps), [activeOps]);

    const commitProjection = useCallback(
        (
            projection: SchemaGraphProjection,
            result: SchemaVisualizer.GetModelResult,
            preservePositions: boolean,
            states: { nodes: Map<string, string>; edges: Map<string, string> },
        ) => {
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
                ...(states.nodes.has(node.id)
                    ? { className: `schema-graph-node-${states.nodes.get(node.id)}` }
                    : {}),
                data: {
                    id: node.id,
                    schema: node.schema,
                    name: node.name,
                    columns: node.columns,
                },
            }));
            // Legacy parity: no per-edge FK label — the FK name lives in
            // edge.data and renders in the properties pane only.
            const nextEdges: Edge[] = projection.edges.map((edge) => ({
                id: edge.id,
                source: edge.sourceNodeId,
                target: edge.targetNodeId,
                ...(states.edges.has(edge.id)
                    ? { className: `schema-graph-edge-${states.edges.get(edge.id)}` }
                    : {}),
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

    const buildGraph = useCallback(
        (result: SchemaVisualizer.GetModelResult, preservePositions: boolean) => {
            commitProjection(projectGraph(result.model), result, preservePositions, {
                nodes: new Map(),
                edges: new Map(),
            });
        },
        [commitProjection],
    );

    // Live edit re-projection: whenever the reduced model changes while a
    // graph is showing, re-commit the canvas from the EDITED model.
    const lastEditProjectionRef = useRef<{ model: EditableModel; ops: number } | undefined>(
        undefined,
    );
    useEffect(() => {
        if (load.phase !== "graph" || editedModel === undefined) {
            return;
        }
        if (!dirty && lastEditProjectionRef.current === undefined) {
            return; // pristine: buildGraph already rendered the baseline
        }
        if (
            lastEditProjectionRef.current?.model === editedModel &&
            lastEditProjectionRef.current?.ops === activeOps.length
        ) {
            return;
        }
        lastEditProjectionRef.current = dirty
            ? { model: editedModel, ops: activeOps.length }
            : undefined;
        const projection = dirty
            ? projectEditableGraph(editedModel, load.result.model)
            : projectGraph(load.result.model);
        commitProjection(projection, load.result, true, {
            nodes: editStates.nodes,
            edges: editStates.edges,
        });
    }, [activeOps.length, commitProjection, dirty, editStates, editedModel, load]);

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

    // §7 op-log lifecycle: every log/cursor change bumps the host revision.
    useEffect(() => {
        editRevisionRef.current++;
        void rpc.sendNotification(SchemaVisualizer.EditedNotification.type, {});
    }, [ops, cursor, rpc]);

    const newId = useCallback(() => crypto.randomUUID(), []);

    /** Validate against the CURRENT reduced model, then append at the cursor. */
    const captureOps = useCallback(
        (newOps: SchemaVisualizerEditOp[]) => {
            if (editedModel === undefined || newOps.length === 0) {
                return;
            }
            let model = editedModel;
            for (const op of newOps) {
                const result = applyEdit(model, op);
                if (result.ok === false) {
                    setEditError(result.conflict.message);
                    return;
                }
                model = result.model;
            }
            setEditError(undefined);
            setOps((current) => [...current.slice(0, cursor), ...newOps]);
            setCursor((current) => current + newOps.length);
        },
        [cursor, editedModel],
    );

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

    const rebaseDirtyEdits = useCallback(async () => {
        // Fetch the fresh baseline, then replay the NORMALIZED log onto it.
        // Conflicts stop the replay (§7.5): the log is never discarded
        // silently — the user sees the first conflict and decides.
        try {
            const params: SchemaVisualizer.GetModelParams =
                currentFilterRef.current !== undefined
                    ? { objectIds: currentFilterRef.current }
                    : {};
            const result = await rpc.sendRequest(SchemaVisualizer.RefreshRequest.type, params);
            const normalized = normalizeOperations(activeOps);
            const outcome = rebaseOperations(result.model, normalized);
            if (outcome.state === "conflict") {
                setEditError(
                    `Rebase stopped at a conflict after ${outcome.appliedCount} of ${normalized.length} edits: ${outcome.conflict.message} ` +
                        "Your edits are unchanged — resolve by undoing the conflicting edit or discarding.",
                );
                return;
            }
            setDriftPending(false);
            setEditError(undefined);
            setOps(normalized);
            setCursor(normalized.length);
            setLoad({ phase: "graph", result });
            lastEditProjectionRef.current = undefined; // force re-projection
        } catch (error) {
            setEditError(error instanceof Error ? error.message : String(error));
        }
    }, [activeOps, rpc]);

    const capabilities =
        load.phase === "graph" || load.phase === "searchFirst"
            ? load.result.model.capabilities
            : undefined;
    const freshness =
        load.phase === "graph" || load.phase === "searchFirst" ? load.result.freshness : undefined;
    const diagramLimited =
        capabilities !== undefined && capabilities.diagramNodes.state !== "available";
    // §7/§9 gate: identity-grade column facts are the edit precondition.
    const editEnabled =
        load.phase === "graph" &&
        capabilities !== undefined &&
        capabilities.columnIdentityGrade.state === "available";
    const editDisabledReason = editEnabled
        ? undefined
        : "Editing requires identity-grade column metadata for this database.";

    const selectedEditableTable: EditableTable | undefined = useMemo(() => {
        if (editedModel === undefined || selectedTableId === undefined) {
            return undefined;
        }
        for (const table of editedModel.tables.values()) {
            const nodeId =
                table.ref.kind === "existing"
                    ? `table:${table.ref.objectId}`
                    : `new-table:${table.ref.localId}`;
            if (nodeId === selectedTableId) {
                return table;
            }
        }
        return undefined;
    }, [editedModel, selectedTableId]);

    const selectedBaselineTable =
        load.phase === "graph" && selectedTableId !== undefined
            ? load.result.model.tables.find((table) => table.graphId === selectedTableId)
            : undefined;

    /** FKs (edited state) touching the selected table — edit affordances. */
    const selectedFks = useMemo(() => {
        if (editedModel === undefined || selectedEditableTable === undefined) {
            return [];
        }
        const key =
            selectedEditableTable.ref.kind === "existing"
                ? `t:${selectedEditableTable.ref.objectId}`
                : `tn:${selectedEditableTable.ref.localId}`;
        return [...editedModel.foreignKeys.values()].filter(
            (fk) => fk.fromTableKey === key || fk.toTableKey === key,
        );
    }, [editedModel, selectedEditableTable]);

    const openPublish = () => {
        setPublishNotice(undefined);
        setPublishOpen(true);
    };

    const filterableTables =
        load.phase === "graph" || load.phase === "searchFirst" ? load.result.model.tables : [];

    return (
        <div className={styles.root}>
            <Toolbar className={styles.toolbar} size="small">
                <ToolbarButton
                    appearance="primary"
                    icon={<DatabaseArrowUpRegular />}
                    disabled={!dirty}
                    title={editDisabledReason ?? locConstants.schemaDesigner.publishChanges}
                    onClick={openPublish}>
                    {locConstants.schemaDesigner.publishChanges}
                </ToolbarButton>
                <ToolbarDivider />
                <ToolbarButton
                    icon={<ArrowUndoRegular />}
                    disabled={cursor === 0}
                    title={locConstants.schemaDesigner.undo}
                    aria-label={locConstants.schemaDesigner.undo}
                    onClick={() => setCursor((current) => Math.max(0, current - 1))}
                />
                <ToolbarButton
                    icon={<ArrowRedoRegular />}
                    disabled={cursor >= ops.length}
                    title={locConstants.schemaDesigner.redo}
                    aria-label={locConstants.schemaDesigner.redo}
                    onClick={() => setCursor((current) => Math.min(ops.length, current + 1))}
                />
                <ToolbarDivider />
                <ToolbarButton
                    icon={<TableAddRegular />}
                    disabled={!editEnabled}
                    title={editDisabledReason ?? locConstants.schemaDesigner.addTable}
                    onClick={() =>
                        setEditorMode({
                            kind: "new",
                            localId: newId(),
                            defaultSchema:
                                baselineModel?.tables[0]?.schema !== undefined
                                    ? baselineModel.tables[0].schema
                                    : "dbo",
                        })
                    }>
                    {locConstants.schemaDesigner.addTable}
                </ToolbarButton>
                <ToolbarButton
                    icon={<DeleteRegular />}
                    disabled={!editEnabled || selectedEditableTable === undefined}
                    title={editDisabledReason ?? locConstants.schemaDesigner.delete}
                    onClick={() => {
                        if (selectedEditableTable !== undefined) {
                            captureOps([
                                {
                                    version: 1,
                                    operationId: newId(),
                                    kind: "dropTable",
                                    table: selectedEditableTable.ref,
                                },
                            ]);
                            setSelectedTableId(undefined);
                        }
                    }}>
                    {locConstants.schemaDesigner.delete}
                </ToolbarButton>
                <ToolbarDivider />
                <ToolbarButton
                    icon={<ArrowFlowUpRightRegular />}
                    title={locConstants.schemaDesigner.autoArrange}
                    onClick={() => {
                        positionsRef.current.clear();
                        lastEditProjectionRef.current = undefined;
                        if (load.phase === "graph") {
                            if (dirty && editedModel !== undefined) {
                                commitProjection(
                                    projectEditableGraph(editedModel, load.result.model),
                                    load.result,
                                    false,
                                    { nodes: editStates.nodes, edges: editStates.edges },
                                );
                            } else {
                                buildGraph(load.result, false);
                            }
                        }
                    }}>
                    {locConstants.schemaDesigner.autoArrange}
                </ToolbarButton>
                <Popover
                    open={filterOpen}
                    onOpenChange={(_e, data) => {
                        setFilterOpen(data.open);
                        if (data.open) {
                            setFilterDraft(new Set(currentFilterRef.current ?? []));
                        }
                    }}>
                    <PopoverTrigger disableButtonEnhancement>
                        <ToolbarButton icon={<FilterRegular />}>
                            {locConstants.schemaDesigner.filter(
                                currentFilterRef.current?.length ?? 0,
                            )}
                        </ToolbarButton>
                    </PopoverTrigger>
                    <PopoverSurface>
                        <div className={styles.filterList}>
                            {filterableTables.map((table) => (
                                <Checkbox
                                    key={table.identity.objectId}
                                    label={`${table.schema}.${table.name}`}
                                    checked={filterDraft.has(table.identity.objectId)}
                                    onChange={(_e, data) =>
                                        setFilterDraft((current) => {
                                            const next = new Set(current);
                                            if (data.checked === true) {
                                                next.add(table.identity.objectId);
                                            } else {
                                                next.delete(table.identity.objectId);
                                            }
                                            return next;
                                        })
                                    }
                                />
                            ))}
                            {filterableTables.length === 0 && <Text>No tables loaded.</Text>}
                        </div>
                        <div className={styles.filterActions}>
                            <Button
                                appearance="primary"
                                size="small"
                                disabled={filterDraft.size === 0}
                                onClick={() => {
                                    setFilterOpen(false);
                                    void requestModel([...filterDraft]);
                                }}>
                                Apply
                            </Button>
                            <Button
                                size="small"
                                onClick={() => {
                                    setFilterOpen(false);
                                    void requestModel(undefined);
                                }}>
                                Clear
                            </Button>
                        </div>
                    </PopoverSurface>
                </Popover>
                <ToolbarDivider />
                <ToolbarButton
                    icon={<ArrowClockwiseRegular />}
                    title="Refresh"
                    onClick={() => void requestModel(currentFilterRef.current, { refresh: true })}>
                    Refresh
                </ToolbarButton>
                <div className={styles.toolbarSpacer} />
                <Input
                    className={styles.searchInput}
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
                {freshness !== undefined && freshness.freshness !== "validated" && (
                    <Badge
                        appearance="outline"
                        color={freshness.freshness === "live" ? "success" : "warning"}>
                        {freshness.freshness} ({freshness.source})
                    </Badge>
                )}
                {dirty && (
                    <Badge appearance="filled" color="brand">
                        {activeOps.length} pending edit{activeOps.length === 1 ? "" : "s"}
                    </Badge>
                )}
                {load.phase === "graph" && (
                    <Text size={200}>
                        {load.result.renderedTables} of {load.result.totalTables} tables
                    </Text>
                )}
            </Toolbar>
            {publishNotice !== undefined && (
                <MessageBar intent={publishNotice.kind === "success" ? "success" : "warning"}>
                    <MessageBarBody>
                        {publishNotice.kind === "success"
                            ? "Changes published."
                            : "Changes published, but the diagram refresh failed — use Refresh to reload."}
                    </MessageBarBody>
                </MessageBar>
            )}
            {editError !== undefined && (
                <MessageBar intent="error">
                    <MessageBarBody>
                        {editError}{" "}
                        <Button size="small" onClick={() => setEditError(undefined)}>
                            Dismiss
                        </Button>
                    </MessageBarBody>
                </MessageBar>
            )}
            {driftPending && !dirty && (
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
            {driftPending && dirty && (
                <MessageBar intent="warning">
                    <MessageBarBody>
                        The database schema changed while you have {activeOps.length} pending edit
                        {activeOps.length === 1 ? "" : "s"}.{" "}
                        <Button size="small" onClick={() => void rebaseDirtyEdits()}>
                            Rebase edits
                        </Button>{" "}
                        <Button
                            size="small"
                            onClick={() => {
                                setOps([]);
                                setCursor(0);
                                setEditError(undefined);
                                void requestModel(currentFilterRef.current);
                            }}>
                            Discard edits
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
                                onNodeDoubleClick={(nodeId) => {
                                    if (!editEnabled || editedModel === undefined) {
                                        return;
                                    }
                                    setSelectedTableId(nodeId);
                                    for (const table of editedModel.tables.values()) {
                                        const id =
                                            table.ref.kind === "existing"
                                                ? `table:${table.ref.objectId}`
                                                : `new-table:${table.ref.localId}`;
                                        if (id === nodeId) {
                                            setEditorMode({ kind: "edit", table });
                                            return;
                                        }
                                    }
                                }}
                            />
                        </div>
                        {(selectedBaselineTable !== undefined ||
                            selectedEditableTable !== undefined) && (
                            <div className={styles.sidebar}>
                                {editEnabled && selectedEditableTable !== undefined && (
                                    <div>
                                        <Button
                                            icon={<EditRegular />}
                                            onClick={() =>
                                                setEditorMode({
                                                    kind: "edit",
                                                    table: selectedEditableTable,
                                                })
                                            }>
                                            Edit Table
                                        </Button>
                                    </div>
                                )}
                                {selectedBaselineTable !== undefined && (
                                    <SchemaVisualizerProperties
                                        table={selectedBaselineTable}
                                        foreignKeys={load.result.model.foreignKeys.filter(
                                            (fk) =>
                                                fk.fromObjectId ===
                                                    selectedBaselineTable.identity.objectId ||
                                                fk.toObjectId ===
                                                    selectedBaselineTable.identity.objectId,
                                        )}
                                        capabilities={load.result.model.capabilities}
                                        model={load.result.model}
                                    />
                                )}
                                {editEnabled && selectedFks.length > 0 && (
                                    <div className={styles.fkEditRow}>
                                        <Text weight="semibold" size={200}>
                                            Foreign key actions
                                        </Text>
                                        {selectedFks.map((fk) => {
                                            const fkKeyId =
                                                fk.ref.kind === "existing"
                                                    ? `fk:${fk.ref.constraintObjectId}`
                                                    : `new-fk:${fk.ref.localId}`;
                                            return (
                                                <div key={fkKeyId} className={styles.fkEditRow}>
                                                    <Text size={200}>{fk.name}</Text>
                                                    <div className={styles.fkActionRow}>
                                                        <Text size={200}>On delete</Text>
                                                        <Select
                                                            size="small"
                                                            value={
                                                                fk.onDelete === "UNKNOWN"
                                                                    ? "NO_ACTION"
                                                                    : fk.onDelete
                                                            }
                                                            onChange={(_e, data) =>
                                                                captureOps([
                                                                    {
                                                                        version: 1,
                                                                        operationId: newId(),
                                                                        kind: "setForeignKeyActions",
                                                                        foreignKey: fk.ref,
                                                                        onDelete:
                                                                            data.value as (typeof FkReferentialActionValues)[number],
                                                                        onUpdate:
                                                                            fk.onUpdate ===
                                                                            "UNKNOWN"
                                                                                ? "NO_ACTION"
                                                                                : fk.onUpdate,
                                                                    },
                                                                ])
                                                            }>
                                                            {FkReferentialActionValues.map(
                                                                (action) => (
                                                                    <option
                                                                        key={action}
                                                                        value={action}>
                                                                        {action}
                                                                    </option>
                                                                ),
                                                            )}
                                                        </Select>
                                                    </div>
                                                    <div className={styles.fkActionRow}>
                                                        <Text size={200}>On update</Text>
                                                        <Select
                                                            size="small"
                                                            value={
                                                                fk.onUpdate === "UNKNOWN"
                                                                    ? "NO_ACTION"
                                                                    : fk.onUpdate
                                                            }
                                                            onChange={(_e, data) =>
                                                                captureOps([
                                                                    {
                                                                        version: 1,
                                                                        operationId: newId(),
                                                                        kind: "setForeignKeyActions",
                                                                        foreignKey: fk.ref,
                                                                        onDelete:
                                                                            fk.onDelete ===
                                                                            "UNKNOWN"
                                                                                ? "NO_ACTION"
                                                                                : fk.onDelete,
                                                                        onUpdate:
                                                                            data.value as (typeof FkReferentialActionValues)[number],
                                                                    },
                                                                ])
                                                            }>
                                                            {FkReferentialActionValues.map(
                                                                (action) => (
                                                                    <option
                                                                        key={action}
                                                                        value={action}>
                                                                        {action}
                                                                    </option>
                                                                ),
                                                            )}
                                                        </Select>
                                                        <Button
                                                            size="small"
                                                            appearance="subtle"
                                                            icon={<DeleteRegular />}
                                                            title="Drop foreign key"
                                                            aria-label={`Drop foreign key ${fk.name}`}
                                                            onClick={() =>
                                                                captureOps([
                                                                    {
                                                                        version: 1,
                                                                        operationId: newId(),
                                                                        kind: "dropForeignKey",
                                                                        foreignKey: fk.ref,
                                                                    },
                                                                ])
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
            {editorMode !== undefined && (
                <SchemaVisualizerTableEditor
                    mode={editorMode}
                    newId={newId}
                    onSave={(newOps) => {
                        captureOps(newOps);
                        setEditorMode(undefined);
                    }}
                    onClose={() => setEditorMode(undefined)}
                />
            )}
            {publishOpen && (
                <SchemaVisualizerPublishDialog
                    operations={normalizeOperations(activeOps)}
                    onPublished={(refreshFailed) => {
                        setPublishOpen(false);
                        setOps([]);
                        setCursor(0);
                        setPublishNotice({
                            kind: refreshFailed ? "refreshFailed" : "success",
                        });
                        lastEditProjectionRef.current = undefined;
                        void requestModel(currentFilterRef.current, { refresh: true });
                    }}
                    onClose={() => setPublishOpen(false)}
                />
            )}
        </div>
    );
};
