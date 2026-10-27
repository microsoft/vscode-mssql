/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Caption1,
    makeStyles,
    shorthands,
    Subtitle2,
    Title3,
    tokens,
} from "@fluentui/react-components";
import {
    Chat16Regular,
    Copy16Regular,
    DocumentText16Regular,
    Star20Filled,
    Star20Regular,
} from "@fluentui/react-icons";
import { CSSProperties, Ref, useRef, useState } from "react";
import {
    ContinueInChatRequest,
    CopyTextRequest,
    GetQueryDetailsRequest,
    OpenSqlScriptRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
    type QueryPageTab,
    type QueryStoreQueryDetails,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { SegmentedControl } from "../../common/segmentedControl";
import { isFirstLoad, useExtensionRequest } from "../../common/useExtensionRequest";
import { VscodeEditor } from "../../common/vscodeMonaco";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { useFavoriteQueries } from "./performanceDashboardFavorites";
import { dateTimeFormat, formatNumber } from "./performanceDashboardFormat";
import {
    ReadOnlyNotice,
    StatStrip,
    StatusBar,
    isReadOnly,
    readData,
} from "./performanceDashboardParts";
import { HistoryControls } from "./performanceDashboardPlanHistory";
import { PerformanceDashboardQueryCompare } from "./performanceDashboardQueryCompare";
import { PerformanceDashboardQueryHistory } from "./performanceDashboardQueryHistory";
import { PerformanceDashboardQueryPlans } from "./performanceDashboardQueryPlans";
import { PerformanceDashboardQueryWaits } from "./performanceDashboardQueryWaits";
import { useRefresh } from "./performanceDashboardRefresh";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { Splitter, useSideWidth } from "./performanceDashboardSplitter";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useViewTimeRange } from "./performanceDashboardTimeRange";

const queryTabs: readonly QueryPageTab[] = ["history", "waits", "compare", "plans"];

/** The metrics of the query's stats strip. */
const detailMetrics = ["duration"] as const;

/** Below this width, the query text goes below the tabs. */
const narrowLayout = "@media (max-width: 900px)";
/** The limits of the query text panel, which the user resizes. */
const queryTextLimits = { min: 280, maxShare: 0.6, mainMin: 504 };
const queryTextWidthKey = "performanceDashboard.queryTextWidth";

const useStyles = makeStyles({
    // Grows to the bottom of the page, so the grid of the tab can fill the space left.
    // The query text is beside the main content, with a divider that resizes it. Its width is
    // the user's, or the default; it never takes more than 60% of the page.
    page: {
        display: "grid",
        flex: "1 0 auto",
        gridTemplateColumns:
            "minmax(0, 1fr) 24px min(var(--query-text-width, clamp(280px, 28vw, 380px)), 60%)",
        gridTemplateRows: "auto 1fr",
        gridTemplateAreas: `"header header header" "main splitter aside"`,
        rowGap: "16px",
        [narrowLayout]: {
            gridTemplateColumns: "minmax(0, 1fr)",
            gridTemplateRows: "auto 1fr auto",
            gridTemplateAreas: `"header" "main" "aside"`,
        },
    },
    header: {
        gridArea: "header",
        display: "flex",
        alignItems: "center",
        ...shorthands.gap("8px"),
        minWidth: 0,
    },
    heading: {
        ...shorthands.margin(0),
        whiteSpace: "nowrap",
    },
    headerEnd: {
        marginLeft: "auto",
    },
    actions: {
        display: "flex",
        flexWrap: "wrap",
        ...shorthands.gap("8px"),
    },
    // The stats are over the charts and grids only; the query text is beside them.
    main: {
        gridArea: "main",
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("12px"),
        minWidth: 0,
    },
    // The tabs, and the selects of the charts on the right.
    toolbar: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        ...shorthands.gap("8px", "16px"),
        minHeight: "28px",
    },
    tabLabel: {
        display: "inline-flex",
        alignItems: "center",
        ...shorthands.gap("6px"),
    },
    // A pill in the text color of the tab, so it shows on the selected and the other tabs.
    count: {
        minWidth: "16px",
        padding: "0 5px",
        borderRadius: "8px",
        fontSize: tokens.fontSizeBase100,
        lineHeight: "16px",
        textAlign: "center",
        color: "inherit",
        backgroundColor: "color-mix(in srgb, currentColor 22%, transparent)",
    },
    // The query text is as tall as the tab content, so the page has one scroll bar.
    splitter: {
        gridArea: "splitter",
        [narrowLayout]: {
            display: "none",
        },
    },
    aside: {
        gridArea: "aside",
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("12px"),
        minWidth: 0,
    },
    // The title, and the actions on the query text.
    asideTitle: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        ...shorthands.gap("8px"),
        minHeight: "28px",
    },
    editorFrame: {
        position: "relative",
        flexGrow: 1,
        minHeight: "320px",
        border: "1px solid var(--vscode-panel-border)",
        borderRadius: tokens.borderRadiusMedium,
        overflow: "hidden",
        [narrowLayout]: {
            flexGrow: 0,
            height: "320px",
        },
    },
    editor: {
        position: "absolute",
        inset: 0,
    },
    secondary: {
        color: tokens.colorNeutralForeground3,
    },
});

/**
 * One query: its statistics in the time range, its execution history and plans, and its text.
 * The tab is in the location, for example `queries/913?tab=plans`.
 */
export const PerformanceDashboardQueryPage = () => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { router, match, navigate } = useNavigation<PerformanceDashboardRoute>();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const { window } = useViewTimeRange();
    const favorites = useFavoriteQueries();
    const queryId = match.params.queryId;
    const tab: QueryPageTab = queryTabs.includes(match.query.tab as QueryPageTab)
        ? (match.query.tab as QueryPageTab)
        : "history";
    const { extensionRpc } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const showTab = (value: QueryPageTab) =>
        navigate(
            router.build("query", match.params, {
                ...match.query,
                tab: value === "history" ? undefined : value,
            }),
        );
    const details = useExtensionRequest(
        GetQueryDetailsRequest.type,
        { queryId, metrics: detailMetrics, ...window },
        [databaseName, refreshKey],
    );
    const message = readStatusMessage(details);
    const data = readData(details);
    const isFavorite = favorites.queryIds.has(queryId);
    const queryText = data?.queryText;
    const planCount = data?.totalPlanCount;
    const page = useRef<HTMLDivElement>(null);
    const panel = useRef<HTMLElement>(null);
    const queryTextWidth = useSideWidth(queryTextWidthKey, page, queryTextLimits);

    return (
        <div
            ref={page}
            className={classes.page}
            style={
                queryTextWidth.width !== undefined
                    ? ({ "--query-text-width": `${queryTextWidth.width}px` } as CSSProperties)
                    : undefined
            }>
            <div className={classes.header}>
                <Title3 as="h1" className={classes.heading}>
                    {text.queryNumber(queryId)}
                </Title3>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={isFavorite ? <Star20Filled /> : <Star20Regular />}
                    aria-pressed={isFavorite}
                    aria-label={
                        isFavorite ? text.removeFavorite(queryId) : text.addFavorite(queryId)
                    }
                    onClick={() => favorites.toggle(queryId, !isFavorite)}
                />
                {data?.forcedPlanId && (
                    <Badge appearance="tint" color="brand" shape="rounded">
                        {text.planForcedBadge(data.forcedPlanId)}
                    </Badge>
                )}
                <Button
                    className={classes.headerEnd}
                    size="small"
                    icon={<Chat16Regular />}
                    onClick={() =>
                        void extensionRpc.sendRequest(ContinueInChatRequest.type, {
                            queryId,
                            ...window,
                        })
                    }>
                    {text.openInChat}
                </Button>
            </div>
            <div className={classes.main}>
                {isReadOnly(details) && <ReadOnlyNotice />}
                {message ? (
                    <StatusBar message={message} />
                ) : isFirstLoad(details) ? (
                    <QueryStats />
                ) : data ? (
                    <QueryStats details={data} />
                ) : (
                    <Caption1 className={classes.secondary}>{text.queryNotFound}</Caption1>
                )}
                <div className={classes.toolbar}>
                    <SegmentedControl<QueryPageTab>
                        size="small"
                        ariaLabel={text.queryViews}
                        value={tab}
                        options={[
                            { value: "history", label: text.executionHistory },
                            { value: "waits", label: text.waitsTab },
                            { value: "compare", label: text.compareTab },
                            {
                                value: "plans",
                                label: (
                                    <span className={classes.tabLabel}>
                                        {text.plans}
                                        {planCount !== undefined && (
                                            <span className={classes.count}>
                                                {formatNumber(planCount)}
                                            </span>
                                        )}
                                    </span>
                                ),
                            },
                        ]}
                        onValueChange={(value) => showTab(value)}
                    />
                    {(tab === "history" || tab === "plans") && <HistoryControls />}
                </div>
                {tab === "history" ? (
                    <PerformanceDashboardQueryHistory queryId={queryId} />
                ) : tab === "waits" ? (
                    <PerformanceDashboardQueryWaits queryId={queryId} />
                ) : tab === "compare" ? (
                    <PerformanceDashboardQueryCompare queryId={queryId} />
                ) : (
                    <PerformanceDashboardQueryPlans queryId={queryId} />
                )}
            </div>
            <Splitter
                className={classes.splitter}
                label={text.resizeQueryText}
                width={queryTextWidth.width}
                measure={() => panel.current?.getBoundingClientRect().width ?? 0}
                min={queryTextLimits.min}
                max={() => queryTextWidth.clamp(Number.MAX_SAFE_INTEGER)}
                onResize={queryTextWidth.set}
            />
            <QueryTextPanel queryText={queryText} panelRef={panel} />
        </div>
    );
};

/** The stats of the query, or their labels over placeholders while the details load. */
const QueryStats = ({ details }: { details?: QueryStoreQueryDetails }) => {
    const text = loc.performanceDashboard;
    const durationStats = details?.metrics.duration;
    const duration = (value: number | undefined) =>
        value === undefined ? text.notAvailable : text.milliseconds(formatNumber(value));
    return (
        <StatStrip
            loading={!details}
            stats={[
                {
                    label: text.executionCount,
                    value: details ? formatNumber(details.executionCount) : "",
                },
                { label: text.average, value: duration(durationStats?.avg) },
                { label: text.minShort, value: duration(durationStats?.min) },
                { label: text.maxShort, value: duration(durationStats?.max) },
                // The object only when the query is in one, such as a procedure.
                ...(details?.objectName
                    ? [{ label: text.objectName, value: details.objectName }]
                    : []),
            ]}
            end={{
                label: text.lastExecuted,
                value: details?.lastExecutionTimeUtc
                    ? dateTimeFormat.format(new Date(details.lastExecutionTimeUtc))
                    : text.notAvailable,
            }}
        />
    );
};

/**
 * The query text in a read-only editor, as tall as the tab content beside it, with actions to
 * open it in a query editor on the dashboard's database or copy it.
 */
const QueryTextPanel = ({
    queryText,
    panelRef,
}: {
    queryText: string | undefined;
    panelRef?: Ref<HTMLElement>;
}) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { extensionRpc, themeKind } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const [copied, setCopied] = useState(false);
    return (
        <aside ref={panelRef} className={classes.aside} aria-label={text.queryTextTitle}>
            <div className={classes.asideTitle}>
                <Subtitle2>{text.queryTextTitle}</Subtitle2>
                <div className={classes.actions}>
                    <Button
                        size="small"
                        appearance="primary"
                        icon={<DocumentText16Regular />}
                        disabled={!queryText}
                        onClick={() =>
                            void extensionRpc.sendRequest(OpenSqlScriptRequest.type, {
                                sql: queryText ?? "",
                            })
                        }>
                        {text.openInQueryEditor}
                    </Button>
                    <Button
                        size="small"
                        icon={<Copy16Regular />}
                        disabled={!queryText}
                        onClick={() => {
                            void extensionRpc
                                .sendRequest(CopyTextRequest.type, { text: queryText ?? "" })
                                .then(() => setCopied(true));
                        }}>
                        {copied ? text.copied : text.copySql}
                    </Button>
                </div>
            </div>
            {queryText ? (
                <div className={classes.editorFrame}>
                    <div className={classes.editor}>
                        <VscodeEditor
                            height="100%"
                            width="100%"
                            language="sql"
                            themeKind={themeKind}
                            value={queryText}
                            options={{
                                readOnly: true,
                                domReadOnly: true,
                                lineNumbers: "on",
                                minimap: { enabled: false },
                                scrollBeyondLastLine: false,
                                wordWrap: "on",
                                automaticLayout: true,
                                folding: false,
                                renderLineHighlight: "none",
                                lineDecorationsWidth: 8,
                                fontSize: 12,
                                ariaLabel: text.queryTextEditor,
                            }}
                        />
                    </div>
                </div>
            ) : (
                <Caption1 className={classes.secondary}>{text.noQueryText}</Caption1>
            )}
        </aside>
    );
};
