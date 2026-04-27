/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Button,
    Checkbox,
    Dropdown,
    Option,
    OverlayDrawer,
    Text,
    Tooltip,
    ToggleButton,
    makeStyles,
    mergeClasses,
    shorthands,
    tokens,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import {
    InlineCompletionDebugProfileId,
    InlineCompletionDebugReplayConfig,
    InlineCompletionDebugReplayEventSnapshot,
    InlineCompletionDebugWebviewState,
    InlineCompletionSchemaBudgetProfileId,
} from "../../../../sharedInterfaces/inlineCompletionDebug";
import { useInlineCompletionDebugSelector } from "../inlineCompletionDebugSelector";
import { useInlineCompletionDebugContext } from "../inlineCompletionDebugStateProvider";
import { schemaProfileOptions } from "./Toolbar";

const CAPTURED_VALUE = "__captured__";
const DEFAULT_MODEL_VALUE = "__default__";
const MATRIX_WARNING_THRESHOLD = 100;

const useStyles = makeStyles({
    drawer: {
        width: "min(1220px, 96vw)",
        maxWidth: "96vw",
        height: "100vh",
        maxHeight: "100vh",
        ...shorthands.padding(0),
        backgroundColor: "var(--vscode-editor-background)",
        color: "var(--vscode-foreground)",
    },
    surface: {
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: "52px",
        flexShrink: 0,
        ...shorthands.padding("0", "16px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    titleGroup: {
        display: "flex",
        alignItems: "baseline",
        gap: "12px",
        minWidth: 0,
    },
    title: {
        fontSize: tokens.fontSizeBase500,
        fontWeight: tokens.fontWeightSemibold,
        whiteSpace: "nowrap",
    },
    subtitle: {
        color: "var(--vscode-descriptionForeground)",
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
    },
    content: {
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
    },
    toolbar: {
        minHeight: "42px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        flexShrink: 0,
        ...shorthands.padding("6px", "16px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
        backgroundColor: "var(--vscode-sideBar-background)",
    },
    toolbarGroup: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        minWidth: 0,
    },
    toolbarActionButton: {
        flexShrink: 1,
        minWidth: 0,
        maxWidth: "128px",
        whiteSpace: "nowrap",
        overflowX: "hidden",
        "& .fui-Button__content": {
            minWidth: 0,
            overflowX: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
    },
    tableWrap: {
        flex: 1,
        minHeight: 0,
        overflow: "auto",
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
        fontSize: tokens.fontSizeBase200,
    },
    headerCell: {
        position: "sticky",
        top: 0,
        zIndex: 1,
        height: "30px",
        textAlign: "left",
        color: "var(--vscode-descriptionForeground)",
        backgroundColor: "var(--vscode-editor-background)",
        textTransform: "uppercase",
        fontSize: tokens.fontSizeBase100,
        letterSpacing: "0.04em",
        ...shorthands.padding("0", "8px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    cell: {
        height: "38px",
        verticalAlign: "middle",
        ...shorthands.padding("4px", "8px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
        overflow: "hidden",
    },
    row: {
        cursor: "pointer",
        ":hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
    },
    selectedRow: {
        backgroundColor: "color-mix(in srgb, var(--vscode-focusBorder) 14%, transparent)",
    },
    overrideRow: {
        backgroundColor: "color-mix(in srgb, var(--vscode-focusBorder) 9%, transparent)",
    },
    mono: {
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
    },
    truncate: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    sourceCell: {
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
    },
    sourceHint: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: tokens.fontSizeBase100,
    },
    badges: {
        display: "flex",
        gap: "4px",
        flexWrap: "wrap",
        minWidth: 0,
    },
    badge: {
        display: "inline-flex",
        alignItems: "center",
        minWidth: 0,
        maxWidth: "170px",
        height: "20px",
        ...shorthands.padding("0", "6px"),
        ...shorthands.borderRadius("4px"),
        backgroundColor: "color-mix(in srgb, var(--vscode-descriptionForeground) 14%, transparent)",
        color: "var(--vscode-foreground)",
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
        fontSize: "11px",
    },
    modeBadge: {
        color: "var(--vscode-descriptionForeground)",
    },
    overrideBadge: {
        backgroundColor: "color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent)",
        color: "var(--vscode-focusBorder)",
    },
    liveBadge: {
        backgroundColor: "transparent",
        color: "var(--vscode-descriptionForeground)",
        ...shorthands.border("1px", "dashed", "var(--vscode-descriptionForeground)"),
    },
    footer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        flexShrink: 0,
        minHeight: "54px",
        ...shorthands.padding("8px", "16px"),
        ...shorthands.borderTop("1px", "solid", "var(--vscode-panel-border)"),
    },
    footerGroup: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexShrink: 0,
        flexWrap: "nowrap",
    },
    footerHint: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    footerActionButton: {
        minWidth: "72px",
        whiteSpace: "nowrap",
    },
    footerWideButton: {
        minWidth: "92px",
        whiteSpace: "nowrap",
    },
    rowActionGroup: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        minWidth: 0,
        overflow: "hidden",
        flexWrap: "nowrap",
    },
    rowActionButton: {
        minWidth: 0,
        maxWidth: "72px",
        whiteSpace: "nowrap",
        overflowX: "hidden",
        "& .fui-Button__content": {
            minWidth: 0,
            overflowX: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
    },
    detailPanel: {
        flexShrink: 0,
        display: "grid",
        gridTemplateColumns: "minmax(300px, 420px) minmax(340px, 1fr)",
        gap: "12px",
        maxHeight: "260px",
        overflow: "hidden",
        ...shorthands.padding("12px", "16px"),
        ...shorthands.borderTop("1px", "solid", "var(--vscode-panel-border)"),
        backgroundColor: "var(--vscode-sideBar-background)",
    },
    editPanel: {
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        overflow: "hidden",
    },
    fieldGrid: {
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: "6px",
    },
    fieldRow: {
        display: "grid",
        gridTemplateColumns: "72px minmax(150px, 1fr)",
        alignItems: "center",
        gap: "8px",
        minWidth: 0,
        overflow: "hidden",
    },
    configDropdown: {
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        overflowX: "hidden",
        "& button": {
            minWidth: 0,
            maxWidth: "100%",
            overflowX: "hidden",
        },
        "& span": {
            minWidth: 0,
            overflowX: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
    },
    editActionGroup: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minWidth: 0,
        overflow: "hidden",
        flexWrap: "nowrap",
    },
    editActionButton: {
        minWidth: 0,
        maxWidth: "132px",
        whiteSpace: "nowrap",
        overflowX: "hidden",
        "& .fui-Button__content": {
            minWidth: 0,
            overflowX: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
    },
    label: {
        color: "var(--vscode-descriptionForeground)",
        textTransform: "uppercase",
        fontSize: tokens.fontSizeBase100,
        letterSpacing: "0.05em",
    },
    snapshotPanel: {
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        overflow: "hidden",
    },
    snapshotJson: {
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        margin: 0,
        ...shorthands.padding("8px"),
        ...shorthands.border("1px", "solid", "var(--vscode-panel-border)"),
        ...shorthands.borderRadius("4px"),
        backgroundColor: "var(--vscode-editor-background)",
        color: "var(--vscode-editor-foreground)",
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
        fontSize: "11px",
        lineHeight: "16px",
    },
    matrixContent: {
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        ...shorthands.padding("16px"),
        display: "flex",
        flexDirection: "column",
        gap: "14px",
    },
    matrixGrid: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        gap: "18px",
    },
    matrixColumn: {
        minWidth: 0,
    },
    optionList: {
        minWidth: 0,
        ...shorthands.border("1px", "solid", "var(--vscode-panel-border)"),
        ...shorthands.borderRadius("4px"),
        overflow: "hidden",
    },
    optionRow: {
        display: "grid",
        gridTemplateColumns: "minmax(170px, 0.45fr) minmax(0, 1fr)",
        alignItems: "center",
        columnGap: "14px",
        minHeight: "32px",
        ...shorthands.padding("0", "10px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    optionName: {
        display: "grid",
        gridTemplateColumns: "30px minmax(0, 1fr)",
        alignItems: "center",
        minWidth: 0,
    },
    optionLabel: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    optionDescription: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    summaryBox: {
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(120px, auto)) minmax(0, 1fr)",
        gap: "16px",
        alignItems: "center",
        ...shorthands.padding("12px"),
        ...shorthands.border("1px", "solid", "var(--vscode-focusBorder)"),
        ...shorthands.borderRadius("4px"),
        backgroundColor: "color-mix(in srgb, var(--vscode-focusBorder) 10%, transparent)",
    },
    warningBox: {
        ...shorthands.borderColor("var(--vscode-editorWarning-foreground)"),
        backgroundColor:
            "color-mix(in srgb, var(--vscode-editorWarning-foreground) 16%, transparent)",
        color: "var(--vscode-editorWarning-foreground)",
    },
    metricValue: {
        display: "block",
        fontSize: tokens.fontSizeHero700,
        lineHeight: "36px",
        color: "var(--vscode-focusBorder)",
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
    },
    metricLabel: {
        display: "block",
        color: "var(--vscode-descriptionForeground)",
        textTransform: "uppercase",
        fontSize: tokens.fontSizeBase100,
        letterSpacing: "0.05em",
    },
    executionOrder: {
        ...shorthands.padding("10px", "12px"),
        ...shorthands.border("1px", "solid", "var(--vscode-panel-border)"),
        ...shorthands.borderRadius("4px"),
        backgroundColor: "var(--vscode-editor-background)",
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
        lineHeight: "22px",
    },
    empty: {
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--vscode-descriptionForeground)",
        ...shorthands.padding("32px"),
        textAlign: "center",
    },
});

export function ReplayTraceBuilder() {
    const classes = useStyles();
    const state = useInlineCompletionDebugSelector((value) => value);
    const replay = state.replay;
    const {
        closeReplayBuilder,
        removeFromReplayCart,
        reorderReplayCart,
        clearReplayCart,
        reverseReplayCart,
        setReplayCartOverride,
        setReplayCartConfigMode,
        queueReplayCart,
        runReplayMatrix,
    } = useInlineCompletionDebugContext();
    const [view, setView] = useState<"builder" | "matrix">("builder");
    const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | undefined>();
    const [dragSnapshotId, setDragSnapshotId] = useState<string | undefined>();
    const [draftModel, setDraftModel] = useState(CAPTURED_VALUE);
    const [draftProfile, setDraftProfile] = useState(CAPTURED_VALUE);
    const [draftSchema, setDraftSchema] = useState(CAPTURED_VALUE);
    const [selectedProfiles, setSelectedProfiles] = useState<InlineCompletionDebugProfileId[]>([]);
    const [selectedSchemas, setSelectedSchemas] = useState<InlineCompletionSchemaBudgetProfileId[]>(
        [],
    );
    const [matrixConfirmed, setMatrixConfirmed] = useState(false);
    const [useLiveForRun, setUseLiveForRun] = useState(false);

    const cart = replay.cart;
    const activeRun = replay.runs.find((run) => run.id === replay.activeRunId);
    const runIsActive =
        !!activeRun && (activeRun.status === "queued" || activeRun.status === "running");
    const selectedSnapshot = useMemo(
        () => cart.find((snapshot) => snapshot.id === selectedSnapshotId) ?? cart[0],
        [cart, selectedSnapshotId],
    );
    const selectedIndex = selectedSnapshot
        ? cart.findIndex((snapshot) => snapshot.id === selectedSnapshot.id)
        : -1;
    const averageLatency = useMemo(() => getAverageLatency(state.events), [state.events]);
    const estimateLabel = formatDuration(cart.length * averageLatency);
    const presetProfiles = useMemo(
        () => state.profiles.filter((profile) => profile.id !== "custom"),
        [state.profiles],
    );
    const presetSchemas = useMemo(
        () => schemaProfileOptions.filter((schema) => schema.id !== "custom"),
        [],
    );
    const matrixCells = useMemo(
        () =>
            selectedProfiles.flatMap((profileId, profileIndex) =>
                selectedSchemas.map((schemaId, schemaIndex) => {
                    const profile = presetProfiles.find((item) => item.id === profileId);
                    const schema = presetSchemas.find((item) => item.id === schemaId);
                    return {
                        ordinal: profileIndex * selectedSchemas.length + schemaIndex + 1,
                        profileLabel: profile?.label ?? profileId,
                        schemaLabel: schema?.label ?? schemaId,
                    };
                }),
            ),
        [presetProfiles, presetSchemas, selectedProfiles, selectedSchemas],
    );
    const matrixTotal = matrixCells.length * cart.length;
    const matrixEstimateLabel = formatDuration(matrixTotal * averageLatency);
    const matrixOverBudget = matrixTotal > MATRIX_WARNING_THRESHOLD;

    useEffect(() => {
        if (!replay.builderOpen) {
            setView("builder");
            setSelectedSnapshotId(undefined);
            setDragSnapshotId(undefined);
            setMatrixConfirmed(false);
            setUseLiveForRun(false);
            return;
        }

        if (!selectedSnapshotId && cart[0]) {
            setSelectedSnapshotId(cart[0].id);
        }
    }, [cart, replay.builderOpen, selectedSnapshotId]);

    useEffect(() => {
        if (!selectedSnapshot) {
            setDraftModel(CAPTURED_VALUE);
            setDraftProfile(CAPTURED_VALUE);
            setDraftSchema(CAPTURED_VALUE);
            return;
        }

        setDraftModel(
            hasOwn(selectedSnapshot.override, "modelSelector")
                ? (selectedSnapshot.override?.modelSelector ?? DEFAULT_MODEL_VALUE)
                : CAPTURED_VALUE,
        );
        setDraftProfile(selectedSnapshot.override?.profileId ?? CAPTURED_VALUE);
        setDraftSchema(selectedSnapshot.override?.schemaContext?.budgetProfile ?? CAPTURED_VALUE);
    }, [selectedSnapshot]);

    const openMatrix = useCallback(() => {
        const liveProfile =
            state.overrides.profileId ?? state.defaults.effectiveProfileId ?? "balanced";
        const liveSchema =
            state.overrides.schemaContext?.budgetProfile ??
            state.defaults.schemaContext?.budgetProfile ??
            "balanced";
        setSelectedProfiles(
            presetProfiles.some((profile) => profile.id === liveProfile)
                ? [liveProfile]
                : ["balanced"],
        );
        setSelectedSchemas(
            presetSchemas.some((schema) => schema.id === liveSchema) ? [liveSchema] : ["balanced"],
        );
        setMatrixConfirmed(false);
        setView("matrix");
    }, [
        presetProfiles,
        presetSchemas,
        state.defaults.effectiveProfileId,
        state.defaults.schemaContext?.budgetProfile,
        state.overrides.profileId,
        state.overrides.schemaContext?.budgetProfile,
    ]);

    const close = useCallback(
        (restoreCart: boolean) => {
            closeReplayBuilder(restoreCart);
            setView("builder");
        },
        [closeReplayBuilder],
    );

    const handleDrop = useCallback(
        (targetSnapshotId: string) => {
            if (!dragSnapshotId || dragSnapshotId === targetSnapshotId) {
                return;
            }
            const fromIndex = cart.findIndex((snapshot) => snapshot.id === dragSnapshotId);
            const toIndex = cart.findIndex((snapshot) => snapshot.id === targetSnapshotId);
            if (fromIndex >= 0 && toIndex >= 0) {
                reorderReplayCart(fromIndex, toIndex);
            }
            setDragSnapshotId(undefined);
        },
        [cart, dragSnapshotId, reorderReplayCart],
    );

    const applyOverride = useCallback(() => {
        if (!selectedSnapshot) {
            return;
        }

        const override: Partial<InlineCompletionDebugReplayConfig> = {};
        if (draftModel !== CAPTURED_VALUE) {
            override.modelSelector = draftModel === DEFAULT_MODEL_VALUE ? null : draftModel;
        }
        if (draftProfile !== CAPTURED_VALUE) {
            override.profileId = draftProfile as InlineCompletionDebugProfileId;
        }
        if (draftSchema !== CAPTURED_VALUE) {
            override.schemaContext = {
                ...(selectedSnapshot.capturedConfig.schemaContext ?? {}),
                budgetProfile: draftSchema as InlineCompletionSchemaBudgetProfileId,
            };
        }

        setReplayCartOverride(
            selectedSnapshot.id,
            Object.keys(override).length > 0 ? override : null,
        );
    }, [draftModel, draftProfile, draftSchema, selectedSnapshot, setReplayCartOverride]);

    const toggleProfile = useCallback(
        (profileId: InlineCompletionDebugProfileId, checked: boolean) => {
            setSelectedProfiles((current) =>
                checked ? [...current, profileId] : current.filter((item) => item !== profileId),
            );
            setMatrixConfirmed(false);
        },
        [],
    );

    const toggleSchema = useCallback(
        (schemaId: InlineCompletionSchemaBudgetProfileId, checked: boolean) => {
            setSelectedSchemas((current) =>
                checked ? [...current, schemaId] : current.filter((item) => item !== schemaId),
            );
            setMatrixConfirmed(false);
        },
        [],
    );

    const startMatrix = useCallback(() => {
        if (matrixOverBudget && !matrixConfirmed) {
            setMatrixConfirmed(true);
            return;
        }

        runReplayMatrix(selectedProfiles, selectedSchemas);
    }, [matrixConfirmed, matrixOverBudget, runReplayMatrix, selectedProfiles, selectedSchemas]);
    const handleClearCart = useCallback(() => {
        clearReplayCart();
        setSelectedSnapshotId(undefined);
    }, [clearReplayCart]);

    return (
        <OverlayDrawer
            position="end"
            size="full"
            className={classes.drawer}
            open={replay.builderOpen}
            onOpenChange={(_, data) => {
                if (!data.open) {
                    close(true);
                }
            }}>
            <div className={classes.surface}>
                <div className={classes.header}>
                    <div className={classes.titleGroup}>
                        {view === "matrix" ? (
                            <Button appearance="subtle" onClick={() => setView("builder")}>
                                Back
                            </Button>
                        ) : null}
                        <Text className={classes.title}>
                            {view === "matrix" ? "Run config matrix" : "Replay Trace Builder"}
                        </Text>
                        <Text className={classes.subtitle}>
                            {view === "matrix"
                                ? `${cart.length} events x selected configs`
                                : `${cart.length} events · est. ${estimateLabel} sequential at avg ${formatDuration(
                                      averageLatency,
                                  )}/event`}
                        </Text>
                    </div>
                    <Button
                        appearance="subtle"
                        aria-label="Cancel"
                        icon={<Dismiss24Regular />}
                        onClick={() => close(true)}
                    />
                </div>

                {view === "matrix" ? (
                    <div className={classes.content}>
                        <div className={classes.matrixContent}>
                            <div className={classes.matrixGrid}>
                                <MatrixOptionList
                                    title={`Profiles · ${selectedProfiles.length} selected`}
                                    options={presetProfiles.map((profile) => ({
                                        id: profile.id,
                                        label: profile.label,
                                        description: profile.description,
                                        checked: selectedProfiles.includes(profile.id),
                                        onChange: (checked) => toggleProfile(profile.id, checked),
                                    }))}
                                />
                                <MatrixOptionList
                                    title={`Schemas · ${selectedSchemas.length} selected`}
                                    options={presetSchemas.map((schema) => ({
                                        id: schema.id,
                                        label: schema.label,
                                        description: schema.description,
                                        checked: selectedSchemas.includes(schema.id),
                                        onChange: (checked) => toggleSchema(schema.id, checked),
                                    }))}
                                />
                            </div>

                            <div
                                className={mergeClasses(
                                    classes.summaryBox,
                                    matrixOverBudget && matrixConfirmed && classes.warningBox,
                                )}>
                                <div>
                                    <span className={classes.metricValue}>{matrixTotal}</span>
                                    <span className={classes.metricLabel}>Total completions</span>
                                </div>
                                <div>
                                    <span className={classes.metricValue}>
                                        {matrixEstimateLabel}
                                    </span>
                                    <span className={classes.metricLabel}>Est. sequential</span>
                                </div>
                                <div>
                                    <span className={classes.metricValue}>
                                        {matrixCells.length}
                                    </span>
                                    <span className={classes.metricLabel}>Matrix cells</span>
                                </div>
                                <Text className={classes.mono}>
                                    {selectedProfiles.length} profiles x {selectedSchemas.length}{" "}
                                    schemas x {cart.length} events = {matrixTotal}
                                    {matrixOverBudget && matrixConfirmed
                                        ? " · over 100 completions"
                                        : ""}
                                </Text>
                            </div>

                            <div>
                                <Text className={classes.label}>Execution order</Text>
                                <div className={classes.executionOrder}>
                                    {matrixCells.length > 0
                                        ? matrixCells.map((cell) => (
                                              <span key={cell.ordinal}>
                                                  cell {cell.ordinal}/{matrixCells.length}{" "}
                                                  {cell.profileLabel} x {cell.schemaLabel} {"->"}{" "}
                                                  events 1..{cart.length}
                                                  <br />
                                              </span>
                                          ))
                                        : "Select at least one profile and schema."}
                                </div>
                            </div>

                            <Text className={classes.subtitle}>
                                Matrix runs ignore per-row cart overrides; the matrix cell profile
                                and schema win. Resulting events are tagged with replayTraceId,
                                replayRunId, replayMatrixCellId, and replaySourceEventId.
                            </Text>
                        </div>
                        <div className={classes.footer}>
                            <Text className={mergeClasses(classes.subtitle, classes.footerHint)}>
                                Run queues immediately into Live and executes sequentially.
                            </Text>
                            <div className={classes.footerGroup}>
                                <Button
                                    className={classes.footerActionButton}
                                    onClick={() => setView("builder")}>
                                    Cancel
                                </Button>
                                <Button
                                    className={classes.footerWideButton}
                                    appearance="primary"
                                    disabled={matrixTotal === 0 || runIsActive}
                                    onClick={startMatrix}>
                                    {matrixOverBudget && matrixConfirmed
                                        ? `Start anyway · ${matrixTotal}`
                                        : `Start matrix run · ${matrixTotal}`}
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className={classes.content}>
                        <div className={classes.toolbar}>
                            <div className={classes.toolbarGroup}>
                                {runIsActive ? (
                                    <Text className={classes.subtitle}>
                                        Another run is active; queue controls are paused.
                                    </Text>
                                ) : null}
                            </div>
                            <div className={classes.toolbarGroup}>
                                <Tooltip
                                    content="Queue every row with current toolbar settings. Row settings stay unchanged."
                                    relationship="label">
                                    <ToggleButton
                                        className={classes.toolbarActionButton}
                                        size="small"
                                        checked={useLiveForRun}
                                        disabled={cart.length === 0}
                                        onClick={() => setUseLiveForRun((current) => !current)}>
                                        Use live
                                    </ToggleButton>
                                </Tooltip>
                                <Button
                                    className={classes.toolbarActionButton}
                                    size="small"
                                    disabled={cart.length < 2}
                                    onClick={reverseReplayCart}>
                                    Reverse order
                                </Button>
                                <Button
                                    className={classes.toolbarActionButton}
                                    size="small"
                                    appearance="secondary"
                                    disabled={cart.length === 0}
                                    onClick={handleClearCart}>
                                    Clear all
                                </Button>
                            </div>
                        </div>

                        {cart.length > 0 ? (
                            <>
                                <div className={classes.tableWrap}>
                                    <table className={classes.table}>
                                        <colgroup>
                                            <col style={{ width: "56px" }} />
                                            <col style={{ width: "220px" }} />
                                            <col style={{ width: "170px" }} />
                                            <col style={{ width: "270px" }} />
                                            <col style={{ width: "100px" }} />
                                            <col />
                                            <col style={{ width: "152px" }} />
                                        </colgroup>
                                        <thead>
                                            <tr>
                                                <th className={classes.headerCell}>#</th>
                                                <th className={classes.headerCell}>Source</th>
                                                <th className={classes.headerCell}>Document</th>
                                                <th className={classes.headerCell}>
                                                    Config (model · profile · schema)
                                                </th>
                                                <th className={classes.headerCell}>State</th>
                                                <th className={classes.headerCell}>
                                                    Prompt preview
                                                </th>
                                                <th className={classes.headerCell}>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {cart.map((snapshot, index) => (
                                                <ReplayCartRow
                                                    key={snapshot.id}
                                                    snapshot={snapshot}
                                                    index={index}
                                                    state={state}
                                                    forceLiveForRun={useLiveForRun}
                                                    selected={snapshot.id === selectedSnapshot?.id}
                                                    classes={classes}
                                                    onSelect={() =>
                                                        setSelectedSnapshotId(snapshot.id)
                                                    }
                                                    onMoveUp={() =>
                                                        reorderReplayCart(index, index - 1)
                                                    }
                                                    onMoveDown={() =>
                                                        reorderReplayCart(index, index + 1)
                                                    }
                                                    onDragStart={() =>
                                                        setDragSnapshotId(snapshot.id)
                                                    }
                                                    onDrop={() => handleDrop(snapshot.id)}
                                                    canMoveUp={index > 0}
                                                    canMoveDown={index < cart.length - 1}
                                                />
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {selectedSnapshot ? (
                                    <div className={classes.detailPanel}>
                                        <div className={classes.editPanel}>
                                            <Text className={classes.label}>
                                                Edit config · row {selectedIndex + 1}
                                            </Text>
                                            <div className={classes.fieldGrid}>
                                                <div className={classes.fieldRow}>
                                                    <Text className={classes.label}>Mode</Text>
                                                    <Dropdown
                                                        className={classes.configDropdown}
                                                        size="small"
                                                        selectedOptions={[
                                                            selectedSnapshot.configMode,
                                                        ]}
                                                        value={selectedSnapshot.configMode}
                                                        onOptionSelect={(_, data) =>
                                                            setReplayCartConfigMode(
                                                                selectedSnapshot.id,
                                                                data.optionValue as
                                                                    | "snapshot"
                                                                    | "override"
                                                                    | "live",
                                                            )
                                                        }>
                                                        <Option value="snapshot">snapshot</Option>
                                                        <Option value="override">override</Option>
                                                        <Option value="live">use live</Option>
                                                    </Dropdown>
                                                </div>
                                                <OverrideDropdown
                                                    label="Model"
                                                    value={draftModel}
                                                    onChange={setDraftModel}
                                                    options={[
                                                        {
                                                            value: CAPTURED_VALUE,
                                                            label: `Captured (${formatModelLabel(
                                                                selectedSnapshot.capturedConfig
                                                                    .modelSelector,
                                                                state,
                                                            )})`,
                                                        },
                                                        {
                                                            value: DEFAULT_MODEL_VALUE,
                                                            label: "Default live model",
                                                        },
                                                        ...state.availableModels.map((model) => ({
                                                            value: model.selector,
                                                            label: model.label,
                                                        })),
                                                    ]}
                                                />
                                                <OverrideDropdown
                                                    label="Profile"
                                                    value={draftProfile}
                                                    onChange={setDraftProfile}
                                                    options={[
                                                        {
                                                            value: CAPTURED_VALUE,
                                                            label: `Captured (${formatProfileLabel(
                                                                selectedSnapshot.capturedConfig
                                                                    .profileId,
                                                                state,
                                                            )})`,
                                                        },
                                                        ...presetProfiles.map((profile) => ({
                                                            value: profile.id,
                                                            label: profile.label,
                                                        })),
                                                    ]}
                                                />
                                                <OverrideDropdown
                                                    label="Schema"
                                                    value={draftSchema}
                                                    onChange={setDraftSchema}
                                                    options={[
                                                        {
                                                            value: CAPTURED_VALUE,
                                                            label: `Captured (${formatSchemaLabel(
                                                                selectedSnapshot.capturedConfig
                                                                    .schemaContext?.budgetProfile,
                                                            )})`,
                                                        },
                                                        ...presetSchemas.map((schema) => ({
                                                            value: schema.id,
                                                            label: schema.label,
                                                        })),
                                                    ]}
                                                />
                                            </div>
                                            <div className={classes.editActionGroup}>
                                                <Button
                                                    className={classes.editActionButton}
                                                    size="small"
                                                    onClick={() =>
                                                        setReplayCartOverride(
                                                            selectedSnapshot.id,
                                                            null,
                                                        )
                                                    }>
                                                    Clear override
                                                </Button>
                                                <Button
                                                    className={classes.editActionButton}
                                                    size="small"
                                                    onClick={() =>
                                                        setReplayCartConfigMode(
                                                            selectedSnapshot.id,
                                                            "live",
                                                        )
                                                    }>
                                                    Use live settings
                                                </Button>
                                                <Button
                                                    className={classes.editActionButton}
                                                    size="small"
                                                    onClick={() =>
                                                        removeFromReplayCart(selectedSnapshot.id)
                                                    }>
                                                    Remove
                                                </Button>
                                                <Button
                                                    className={classes.editActionButton}
                                                    size="small"
                                                    appearance="primary"
                                                    onClick={applyOverride}>
                                                    Apply
                                                </Button>
                                            </div>
                                        </div>

                                        <div className={classes.snapshotPanel}>
                                            <Text className={classes.label}>
                                                Captured snapshot (read-only)
                                            </Text>
                                            <pre className={classes.snapshotJson}>
                                                {JSON.stringify(
                                                    {
                                                        sourceEventId:
                                                            selectedSnapshot.sourceEventId,
                                                        capturedAt: selectedSnapshot.capturedAt,
                                                        configMode: selectedSnapshot.configMode,
                                                        capturedConfig:
                                                            selectedSnapshot.capturedConfig,
                                                        override: selectedSnapshot.override,
                                                        event: selectedSnapshot.event,
                                                    },
                                                    undefined,
                                                    2,
                                                )}
                                            </pre>
                                        </div>
                                    </div>
                                ) : null}
                            </>
                        ) : (
                            <div className={classes.empty}>
                                Right-click completed events in Live or Sessions and add them to the
                                replay trace.
                            </div>
                        )}

                        <div className={classes.footer}>
                            <Text className={mergeClasses(classes.subtitle, classes.footerHint)}>
                                Snapshot = add-time config · Override = row config · Live = current
                                toolbar.
                            </Text>
                            <div className={classes.footerGroup}>
                                <Button
                                    className={classes.footerWideButton}
                                    disabled={cart.length === 0 || runIsActive}
                                    onClick={openMatrix}>
                                    Matrix...
                                </Button>
                                <Button
                                    className={classes.footerActionButton}
                                    appearance="primary"
                                    disabled={cart.length === 0 || runIsActive}
                                    onClick={() =>
                                        queueReplayCart(useLiveForRun ? "live" : undefined)
                                    }>
                                    Queue
                                </Button>
                                <Button
                                    className={classes.footerActionButton}
                                    onClick={() => close(true)}>
                                    Cancel
                                </Button>
                                <Button
                                    className={classes.footerActionButton}
                                    appearance="primary"
                                    onClick={() => close(false)}>
                                    OK
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </OverlayDrawer>
    );
}

function ReplayCartRow({
    snapshot,
    index,
    state,
    forceLiveForRun,
    selected,
    classes,
    onSelect,
    onMoveUp,
    onMoveDown,
    onDragStart,
    onDrop,
    canMoveUp,
    canMoveDown,
}: {
    snapshot: InlineCompletionDebugReplayEventSnapshot;
    index: number;
    state: InlineCompletionDebugWebviewState;
    forceLiveForRun: boolean;
    selected: boolean;
    classes: ReturnType<typeof useStyles>;
    onSelect: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onDragStart: () => void;
    onDrop: () => void;
    canMoveUp: boolean;
    canMoveDown: boolean;
}) {
    const rowConfigMode = forceLiveForRun ? "live" : snapshot.configMode;
    const config = forceLiveForRun
        ? getLiveReplayConfig(state)
        : snapshot.configMode === "override"
          ? {
                ...snapshot.capturedConfig,
                ...(snapshot.override ?? {}),
                schemaContext:
                    snapshot.override?.schemaContext ?? snapshot.capturedConfig.schemaContext,
            }
          : snapshot.capturedConfig;
    return (
        <tr
            className={mergeClasses(
                classes.row,
                selected && classes.selectedRow,
                rowConfigMode === "override" && classes.overrideRow,
            )}
            draggable
            onClick={onSelect}
            onDragStart={onDragStart}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
                event.preventDefault();
                onDrop();
            }}>
            <td className={mergeClasses(classes.cell, classes.mono)}>{index + 1}</td>
            <td className={classes.cell}>
                <div className={classes.sourceCell}>
                    <span className={mergeClasses(classes.mono, classes.truncate)}>
                        {snapshot.sourceLabel}
                    </span>
                    <span className={mergeClasses(classes.sourceHint, classes.truncate)}>
                        {formatRelativeTime(snapshot.capturedAt)}
                    </span>
                </div>
            </td>
            <td className={mergeClasses(classes.cell, classes.mono, classes.truncate)}>
                {snapshot.event.documentFileName} · {snapshot.event.line}:{snapshot.event.column}
            </td>
            <td className={classes.cell}>
                <div className={classes.badges}>
                    <span className={mergeClasses(classes.badge, classes.truncate)}>
                        {formatModelLabel(config.modelSelector, state)}
                    </span>
                    <span className={mergeClasses(classes.badge, classes.truncate)}>
                        {formatProfileLabel(config.profileId, state)}
                    </span>
                    <span className={mergeClasses(classes.badge, classes.truncate)}>
                        {formatSchemaLabel(config.schemaContext?.budgetProfile)}
                    </span>
                </div>
            </td>
            <td className={classes.cell}>
                <span
                    className={mergeClasses(
                        classes.badge,
                        classes.modeBadge,
                        rowConfigMode === "override" && classes.overrideBadge,
                        rowConfigMode === "live" && classes.liveBadge,
                    )}>
                    {rowConfigMode === "live" ? "use live" : rowConfigMode}
                </span>
            </td>
            <td className={mergeClasses(classes.cell, classes.mono, classes.truncate)}>
                {getPromptPreview(snapshot.event.promptMessages)}
            </td>
            <td className={classes.cell}>
                <div className={classes.rowActionGroup}>
                    <Tooltip content="Move up" relationship="label">
                        <Button
                            className={classes.rowActionButton}
                            size="small"
                            disabled={!canMoveUp}
                            onClick={onMoveUp}>
                            Up
                        </Button>
                    </Tooltip>
                    <Tooltip content="Move down" relationship="label">
                        <Button
                            className={classes.rowActionButton}
                            size="small"
                            disabled={!canMoveDown}
                            onClick={onMoveDown}>
                            Down
                        </Button>
                    </Tooltip>
                </div>
            </td>
        </tr>
    );
}

function OverrideDropdown({
    label,
    value,
    onChange,
    options,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
}) {
    const classes = useStyles();
    return (
        <div className={classes.fieldRow}>
            <Text className={classes.label}>{label}</Text>
            <Dropdown
                className={classes.configDropdown}
                size="small"
                selectedOptions={[value]}
                value={options.find((option) => option.value === value)?.label ?? value}
                onOptionSelect={(_, data) => onChange(data.optionValue ?? CAPTURED_VALUE)}>
                {options.map((option) => (
                    <Option key={option.value} value={option.value} text={option.label}>
                        {option.label}
                    </Option>
                ))}
            </Dropdown>
        </div>
    );
}

function MatrixOptionList({
    title,
    options,
}: {
    title: string;
    options: Array<{
        id: string;
        label: string;
        description: string;
        checked: boolean;
        onChange: (checked: boolean) => void;
    }>;
}) {
    const classes = useStyles();
    return (
        <div className={classes.matrixColumn}>
            <Text className={classes.label}>{title}</Text>
            <div className={classes.optionList}>
                {options.map((option) => (
                    <div key={option.id} className={classes.optionRow}>
                        <div className={classes.optionName}>
                            <Checkbox
                                aria-label={option.label}
                                checked={option.checked}
                                onChange={(_, data) => option.onChange(data.checked === true)}
                            />
                            <Text className={mergeClasses(classes.mono, classes.optionLabel)}>
                                {option.label}
                            </Text>
                        </div>
                        <Text
                            className={mergeClasses(classes.subtitle, classes.optionDescription)}
                            title={option.description}>
                            {option.description}
                        </Text>
                    </div>
                ))}
            </div>
        </div>
    );
}

function getAverageLatency(events: InlineCompletionDebugWebviewState["events"]): number {
    const completed = events.filter(
        (event) => event.result !== "pending" && event.result !== "queued" && event.latencyMs > 0,
    );
    if (completed.length === 0) {
        return 1200;
    }
    return Math.max(
        1,
        Math.round(
            completed.reduce((total, event) => total + event.latencyMs, 0) / completed.length,
        ),
    );
}

function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${Math.max(1, Math.round(ms))}ms`;
    }
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
}

function formatRelativeTime(timestamp: number): string {
    const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (deltaSeconds < 60) {
        return `${deltaSeconds}s ago`;
    }
    const deltaMinutes = Math.round(deltaSeconds / 60);
    if (deltaMinutes < 60) {
        return `${deltaMinutes}m ago`;
    }
    return new Date(timestamp).toLocaleString();
}

function getLiveReplayConfig(
    state: InlineCompletionDebugWebviewState,
): InlineCompletionDebugReplayConfig {
    return {
        profileId: state.overrides.profileId ?? state.defaults.effectiveProfileId ?? null,
        modelSelector:
            state.overrides.modelSelector ?? state.defaults.effectiveModelSelector ?? null,
        continuationModelSelector:
            state.overrides.continuationModelSelector ??
            state.defaults.effectiveContinuationModelSelector ??
            null,
        useSchemaContext:
            state.overrides.useSchemaContext ?? state.defaults.useSchemaContext ?? null,
        debounceMs: state.overrides.debounceMs ?? state.defaults.debounceMs ?? null,
        maxTokens: state.overrides.maxTokens,
        enabledCategories:
            state.overrides.enabledCategories ?? state.defaults.enabledCategories ?? null,
        forceIntentMode: state.overrides.forceIntentMode,
        customSystemPrompt: state.overrides.customSystemPrompt,
        allowAutomaticTriggers:
            state.overrides.allowAutomaticTriggers ?? state.defaults.allowAutomaticTriggers ?? null,
        schemaContext: state.overrides.schemaContext ?? state.defaults.schemaContext ?? null,
    };
}

function formatModelLabel(
    modelSelector: string | null | undefined,
    state: InlineCompletionDebugWebviewState,
): string {
    if (!modelSelector) {
        return state.defaults.effectiveModelLabel ?? "default";
    }
    return (
        state.availableModels.find((model) => model.selector === modelSelector)?.label ??
        modelSelector
    );
}

function formatProfileLabel(
    profileId: InlineCompletionDebugProfileId | null | undefined,
    state: InlineCompletionDebugWebviewState,
): string {
    if (!profileId) {
        return state.defaults.effectiveProfileId ?? "default";
    }
    return state.profiles.find((profile) => profile.id === profileId)?.label ?? profileId;
}

function formatSchemaLabel(schemaId: InlineCompletionSchemaBudgetProfileId | undefined): string {
    if (!schemaId) {
        return "default";
    }
    return schemaProfileOptions.find((schema) => schema.id === schemaId)?.label ?? schemaId;
}

function getPromptPreview(
    messages: InlineCompletionDebugReplayEventSnapshot["event"]["promptMessages"],
): string {
    const userMessage = messages.find((message) => message.role === "user");
    return userMessage?.content.replace(/\s+/g, " ").trim() ?? "";
}

function hasOwn<T extends object, K extends PropertyKey>(
    value: T | null | undefined,
    key: K,
): value is T & Record<K, unknown> {
    return !!value && Object.prototype.hasOwnProperty.call(value, key);
}
