/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Caption1,
    makeStyles,
    shorthands,
    Spinner,
    Subtitle2,
    Tab,
    TabList,
    Text,
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
import { useExtensionRequest } from "../../common/useExtensionRequest";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { useFavoriteQueries } from "./performanceDashboardFavorites";
import { dateTimeFormat, formatNumber } from "./performanceDashboardFormat";
import { ReadOnlyNotice, StatusBar, isReadOnly, readData } from "./performanceDashboardParts";
import { PerformanceDashboardQueryHistory } from "./performanceDashboardQueryHistory";
import { PerformanceDashboardQueryPlans } from "./performanceDashboardQueryPlans";
import { useRefresh } from "./performanceDashboardRefresh";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useViewTimeRange } from "./performanceDashboardTimeRange";

type QueryTab = "history" | "plans";

const useStyles = makeStyles({
    page: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 2fr) minmax(300px, 1fr)",
        columnGap: "32px",
        rowGap: "16px",
        alignItems: "start",
        "@media (max-width: 1000px)": {
            gridTemplateColumns: "minmax(0, 1fr)",
        },
    },
    main: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("16px"),
        minWidth: 0,
    },
    title: {
        display: "flex",
        alignItems: "center",
        ...shorthands.gap("8px"),
    },
    heading: {
        ...shorthands.margin(0),
    },
    stats: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        columnGap: "24px",
        rowGap: "12px",
    },
    stat: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("2px"),
        minWidth: 0,
    },
    secondary: {
        color: tokens.colorNeutralForeground3,
    },
    statValue: {
        fontWeight: tokens.fontWeightSemibold,
        whiteSpace: "nowrap",
        overflowX: "hidden",
        textOverflow: "ellipsis",
    },
    preview: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("8px"),
        minWidth: 0,
        position: "sticky",
        top: 0,
    },
    code: {
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr)",
        columnGap: "16px",
        ...shorthands.margin(0),
        ...shorthands.padding("12px"),
        ...shorthands.borderRadius(tokens.borderRadiusMedium),
        backgroundColor: "var(--vscode-textCodeBlock-background)",
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        maxHeight: "420px",
        overflowY: "auto",
    },
    lineNumber: {
        color: tokens.colorNeutralForeground4,
        textAlign: "right",
        userSelect: "none",
    },
    line: {
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
    },
    actions: {
        display: "flex",
        flexWrap: "wrap",
        ...shorthands.gap("8px"),
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

    return (
        <div className={classes.page}>
            <div className={classes.main}>
                <div className={classes.title}>
                    <Title3 as="h1" className={classes.heading}>
                        {text.queryNumber(queryId)}
                    </Title3>
                    <Button
                        appearance="subtle"
                        icon={isFavorite ? <Star20Filled /> : <Star20Regular />}
                        aria-pressed={isFavorite}
                        aria-label={
                            isFavorite ? text.removeFavorite(queryId) : text.addFavorite(queryId)
                        }
                        onClick={() => favorites.toggle(queryId, !isFavorite)}
                    />
                </div>
                {isReadOnly(details) && <ReadOnlyNotice />}
                {message ? (
                    <StatusBar message={message} />
                ) : details.loading && !data ? (
                    <Spinner size="small" label={loc.common.loading} />
                ) : data ? (
                    <QueryStats details={data} />
                ) : (
                    <Caption1 className={classes.secondary}>{text.queryNotFound}</Caption1>
                )}
                <TabList
                    size="small"
                    selectedValue={tab}
                    onTabSelect={(_event, selection) =>
                        navigate(
                            router.build("query", match.params, {
                                ...match.query,
                                tab:
                                    selection.value === "history"
                                        ? undefined
                                        : String(selection.value),
                            }),
                        )
                    }>
                    <Tab value="history">{text.executionHistory}</Tab>
                    <Tab value="plans">
                        {data
                            ? text.plansCount(formatNumber(data.totalPlanCount ?? data.planCount))
                            : text.plans}
                    </Tab>
                </TabList>
                {tab === "history" ? (
                    <PerformanceDashboardQueryHistory queryId={queryId} />
                ) : (
                    <PerformanceDashboardQueryPlans queryId={queryId} />
                )}
            </div>
            <QueryPreview queryText={data?.queryText} />
        </div>
    );
};

const QueryStats = ({ details }: { details: QueryDetails }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const stat = (label: string, value: string) => (
        <div className={classes.stat}>
            <Caption1 className={classes.secondary}>{label}</Caption1>
            <Text className={classes.statValue} title={value}>
                {value}
            </Text>
        </div>
    );
    const ms = (value: number | undefined) =>
        value === undefined ? text.notAvailable : formatNumber(value);
    return (
        <div className={classes.stats}>
            {stat(text.objectName, details.objectName ?? "—")}
            {stat(
                text.lastExecuted,
                details.lastExecutionTime
                    ? dateTimeFormat.format(new Date(details.lastExecutionTime))
                    : text.notAvailable,
            )}
            {stat(text.totalExecutionCount, formatNumber(details.executionCount))}
            {stat(
                text.forcePlanStatus,
                details.forcedPlanId ? text.forcedPlan(details.forcedPlanId) : text.notForced,
            )}
            {stat(text.minimumDurationMs, ms(details.minDurationMs))}
            {stat(text.maximumDurationMs, ms(details.maxDurationMs))}
            {stat(text.averageDurationMs, ms(details.avgDurationMs))}
        </div>
    );
};

/** The query text with line numbers, and actions to open or copy it. */
const QueryPreview = ({ queryText }: { queryText: string | undefined }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { extensionRpc } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const [copied, setCopied] = useState(false);
    const lines = (queryText ?? "").split(/\r?\n/);

    return (
        <aside className={classes.preview} aria-label={text.queryPreview}>
            <Subtitle2>{text.queryPreview}</Subtitle2>
            {queryText ? (
                <pre className={classes.code}>
                    {lines.map((line, index) => (
                        <div key={index} style={{ display: "contents" }}>
                            <span className={classes.lineNumber}>{index + 1}</span>
                            <span className={classes.line}>{line || " "}</span>
                        </div>
                    ))}
                </pre>
            ) : (
                <Caption1 className={classes.secondary}>{text.noQueryText}</Caption1>
            )}
            <div className={classes.actions}>
                <Button
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
                    icon={<Copy16Regular />}
                    disabled={!queryText}
                    onClick={() => {
                        void extensionRpc
                            .sendRequest(CopyTextRequest.type, { text: queryText ?? "" })
                            .then(() => setCopied(true));
                    }}>
                    {copied ? text.copied : text.copySqlScript}
                </Button>
            </div>
        </aside>
    );
};
