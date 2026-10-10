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
    Copy16Regular,
    DocumentText16Regular,
    Star20Filled,
    Star20Regular,
} from "@fluentui/react-icons";
import { useState } from "react";
import type { QueryDetails } from "../../../sharedInterfaces/performance";
import {
    CopyTextRequest,
    GetQueryDetailsRequest,
    OpenSqlScriptRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
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
import { PerformanceDashboardQueryHistory } from "./performanceDashboardQueryHistory";
import { PerformanceDashboardQueryPlans } from "./performanceDashboardQueryPlans";
import { useRefresh } from "./performanceDashboardRefresh";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useViewTimeRange } from "./performanceDashboardTimeRange";

type QueryTab = "history" | "plans";

/** Below this width, the query text goes below the tabs. */
const narrowLayout = "@media (max-width: 900px)";

const useStyles = makeStyles({
    // Grows to the bottom of the page, so the grid of the tab can fill the space left.
    page: {
        display: "grid",
        flex: "1 0 auto",
        gridTemplateColumns: "minmax(0, 1fr) clamp(280px, 28vw, 380px)",
        gridTemplateRows: "auto 1fr",
        gridTemplateAreas: `"header header" "main aside"`,
        columnGap: "24px",
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
    const tab: QueryTab = match.query.tab === "plans" ? "plans" : "history";

    const details = useExtensionRequest(GetQueryDetailsRequest.type, { queryId, ...window }, [
        databaseName,
        refreshKey,
    ]);
    const message = readStatusMessage(details);
    const data = readData(details);
    const isFavorite = favorites.queryIds.has(queryId);
    const queryText = data?.queryText;
    const planCount = data ? (data.totalPlanCount ?? data.planCount) : undefined;

    return (
        <div className={classes.page}>
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
                    <SegmentedControl<QueryTab>
                        size="small"
                        ariaLabel={text.queryViews}
                        value={tab}
                        options={[
                            { value: "history", label: text.executionHistory },
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
                        onValueChange={(value) =>
                            navigate(
                                router.build("query", match.params, {
                                    ...match.query,
                                    tab: value === "history" ? undefined : value,
                                }),
                            )
                        }
                    />
                    <HistoryControls />
                </div>
                {tab === "history" ? (
                    <PerformanceDashboardQueryHistory queryId={queryId} />
                ) : (
                    <PerformanceDashboardQueryPlans queryId={queryId} />
                )}
            </div>
            <QueryTextPanel queryText={queryText} />
        </div>
    );
};

/** The stats of the query, or their labels over placeholders while the details load. */
const QueryStats = ({ details }: { details?: QueryDetails }) => {
    const text = loc.performanceDashboard;
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
                { label: text.average, value: duration(details?.avgDurationMs) },
                { label: text.minShort, value: duration(details?.minDurationMs) },
                { label: text.maxShort, value: duration(details?.maxDurationMs) },
                // The object only when the query is in one, such as a procedure.
                ...(details?.objectName
                    ? [{ label: text.objectName, value: details.objectName }]
                    : []),
            ]}
            end={{
                label: text.lastExecuted,
                value: details?.lastExecutionTime
                    ? dateTimeFormat.format(new Date(details.lastExecutionTime))
                    : text.notAvailable,
            }}
        />
    );
};

/**
 * The query text in a read-only editor, as tall as the tab content beside it, with actions to
 * open it in a query editor on the dashboard's database or copy it.
 */
const QueryTextPanel = ({ queryText }: { queryText: string | undefined }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { extensionRpc, themeKind } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const [copied, setCopied] = useState(false);
    return (
        <aside className={classes.aside} aria-label={text.queryTextTitle}>
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
