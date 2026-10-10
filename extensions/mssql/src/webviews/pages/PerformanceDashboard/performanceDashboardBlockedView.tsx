/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Caption1,
    makeStyles,
    mergeClasses,
    shorthands,
    Text,
    tokens,
} from "@fluentui/react-components";
import type { BlockingNode } from "../../../sharedInterfaces/performance";
import {
    GetActiveRequestsRequest,
    GetWaitSeriesRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { isFirstLoad, useExtensionRequest } from "../../common/useExtensionRequest";
import { cpuSummaryWindows } from "./performanceDashboardCpuModel";
import {
    formatElapsed,
    formatNumber,
    formatSeconds,
    timeFormat,
} from "./performanceDashboardFormat";
import {
    SectionHeader,
    StatusBar,
    ChartCard,
    intervalName,
    TimeSeriesChart,
    readData,
} from "./performanceDashboardParts";
import { usePolling, useRefresh } from "./performanceDashboardRefresh";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { bucketMinutesFor, filledSeriesPoints } from "./performanceDashboardSeries";
import { SimpleGrid } from "./performanceDashboardSimpleGrid";
import { TableSkeleton } from "./performanceDashboardSkeletons";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useQueryStoreAvailableFrom, useViewTimeRange } from "./performanceDashboardTimeRange";

/** sys.query_store_wait_stats.wait_category of Lock waits. */
const lockWaitCategoryId = 3;

const useStyles = makeStyles({
    // Grows to the bottom of the page, so the grid can fill the space left.
    view: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("16px"),
        flex: "1 0 auto",
    },
    note: {
        color: tokens.colorNeutralForeground3,
    },
    session: {
        display: "flex",
        alignItems: "center",
        ...shorthands.gap("8px"),
        minWidth: 0,
    },
    branch: {
        color: tokens.colorNeutralForeground4,
        flexShrink: 0,
    },
    client: {
        color: tokens.colorNeutralForeground3,
        whiteSpace: "nowrap",
        overflowX: "hidden",
        textOverflow: "ellipsis",
    },
    state: {
        display: "flex",
        flexDirection: "column",
    },
    statement: {
        fontFamily: tokens.fontFamilyMonospace,
        whiteSpace: "nowrap",
        overflowX: "hidden",
        textOverflow: "ellipsis",
        minWidth: 0,
    },
    headBlocker: {
        backgroundColor: tokens.colorStatusDangerBackground1,
    },
    intermediate: {
        backgroundColor: tokens.colorStatusWarningBackground1,
    },
});

/** A row of the blocking tree: a session and its depth in its chain. */
interface BlockingRow {
    readonly key: string;
    readonly depth: number;
    readonly node: BlockingNode;
}

/** The chains, depth first, so that each blocked session follows the session that blocks it. */
export function blockingRows(chains: readonly BlockingNode[]): BlockingRow[] {
    const rows: BlockingRow[] = [];
    const visit = (node: BlockingNode, depth: number, path: string) => {
        const key = `${path}/${node.sessionId}`;
        rows.push({ key, depth, node });
        node.children.forEach((child) => visit(child, depth + 1, key));
    };
    chains.forEach((chain) => visit(chain, 0, ""));
    return rows;
}

/**
 * Blocking now, as a tree of the head blockers and the sessions that wait for them, refreshed
 * while the tab is visible; and the Lock wait time over the time range, from Query Store.
 */
export const PerformanceDashboardBlockedView = () => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const tick = usePolling();
    const { range, window, now } = useViewTimeRange();
    const availableFrom = useQueryStoreAvailableFrom();

    const activity = useExtensionRequest(
        GetActiveRequestsRequest.type,
        undefined,
        [databaseName, refreshKey],
        true,
        tick,
    );
    const waits = useExtensionRequest(
        GetWaitSeriesRequest.type,
        {
            ...window,
            waitCategoryId: lockWaitCategoryId,
            bucketMinutes: bucketMinutesFor(range),
            windows: cpuSummaryWindows(range, now),
        },
        [databaseName, refreshKey],
    );

    const activityMessage = readStatusMessage(activity);
    const current = readData(activity);
    const observedAt =
        activity.result && "observedAtUtc" in activity.result
            ? activity.result.observedAtUtc
            : undefined;
    const rows = blockingRows(current?.blocking.chains ?? []);

    // Lock waits need wait statistics in Query Store, which some platforms do not record.
    const waitsUnsupported = waits.result?.status === "unsupported";
    const waitData = readData(waits);
    const totals = (waitData?.windowTotals ?? []).map((total) => ({
        startUtc: total.startUtc,
        endUtc: total.endUtc,
        total: total.totalWaitMs,
        executionCount: 0,
    }));
    const [inRange] = totals;
    const points = waitData
        ? filledSeriesPoints(
              waitData.buckets.map((bucket) => ({
                  startUtc: bucket.startUtc,
                  value: bucket.totalWaitMs / 1000,
              })),
              waitData.bucketMinutes,
              range,
              availableFrom,
          )
        : [];

    return (
        <div className={classes.view}>
            {activity.result?.status === "selfOnly" && (
                <StatusBar message={{ intent: "warning", text: text.requestsSelfOnly }} />
            )}
            <ChartCard
                label={text.blockedRequestsNow}
                value={current ? formatNumber(current.blocking.blockedCount) : text.notAvailable}
                figures={[
                    {
                        label: text.headBlockers,
                        value: current
                            ? formatNumber(current.blocking.chains.length)
                            : text.notAvailable,
                    },
                    ...(waitsUnsupported
                        ? []
                        : [
                              {
                                  label: text.lockWaitInRange,
                                  value: inRange ? formatSeconds(inRange.total) : text.notAvailable,
                              },
                          ]),
                ]}
                unit={
                    waitsUnsupported
                        ? undefined
                        : text.lockWaitSecondsPerInterval(
                              intervalName(waitData?.bucketMinutes ?? bucketMinutesFor(range)),
                          )
                }
                loading={activity.loading && !current}>
                {!waitsUnsupported && (
                    <TimeSeriesChart
                        compact
                        title={text.lockWaitSeconds}
                        range={range}
                        points={points}
                        format={(seconds) => formatSeconds(seconds * 1000)}
                        tickFormat={formatNumber}
                        read={waits}
                        message={readStatusMessage(waits)}
                    />
                )}
            </ChartCard>
            <SectionHeader title={text.blockingChain}>
                {observedAt &&
                    text.observedSessions(
                        timeFormat.format(new Date(observedAt)),
                        formatNumber(rows.length),
                    )}
            </SectionHeader>
            {activityMessage ? (
                <StatusBar message={activityMessage} />
            ) : isFirstLoad(activity) ? (
                <TableSkeleton rows={3} numberColumns={4} />
            ) : rows.length === 0 ? (
                current && <Caption1 className={classes.note}>{text.noBlocking}</Caption1>
            ) : (
                <SimpleGrid
                    fill
                    items={rows}
                    getRowId={(row) => row.key}
                    ariaLabel={text.blockingChain}
                    rowClassName={(row) =>
                        row.node.role === "headBlocker"
                            ? classes.headBlocker
                            : row.node.role === "intermediate"
                              ? classes.intermediate
                              : undefined
                    }
                    columns={[
                        {
                            id: "session",
                            header: text.session,
                            idealWidth: 360,
                            minWidth: 200,
                            render: (row) => <SessionCell row={row} />,
                        },
                        {
                            id: "state",
                            header: text.stateAndAge,
                            idealWidth: 140,
                            render: (row) => (
                                <StateCell
                                    node={row.node}
                                    observedAt={observedAt ? new Date(observedAt) : now}
                                />
                            ),
                        },
                        {
                            id: "statement",
                            header: text.statement,
                            idealWidth: 560,
                            minWidth: 200,
                            render: (row) => {
                                const statement =
                                    row.node.request?.statementText ??
                                    row.node.idleSession?.lastStatementText ??
                                    "";
                                return (
                                    <span className={classes.statement} title={statement}>
                                        {statement.replace(/\s+/g, " ")}
                                    </span>
                                );
                            },
                        },
                    ]}
                />
            )}
            {(current?.blocking.nonSessionBlockers.length ?? 0) > 0 && (
                <Caption1 className={classes.note}>
                    {text.nonSessionBlockers(
                        current!.blocking.nonSessionBlockers
                            .map((blocker) => `${blocker.sessionId} (${blocker.blockerCode})`)
                            .join(", "),
                    )}
                </Caption1>
            )}
        </div>
    );
};

const SessionCell = ({ row }: { row: BlockingRow }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { node, depth } = row;
    const source = node.request ?? node.idleSession;
    const client = [source?.loginName, source?.programName].filter(Boolean).join(" · ");
    return (
        <span className={classes.session} style={{ paddingLeft: `${depth * 20}px` }}>
            {depth > 0 && (
                <span className={classes.branch} aria-hidden>
                    └
                </span>
            )}
            <Text weight="semibold">{node.sessionId}</Text>
            {node.role === "headBlocker" && (
                <Badge appearance="tint" color="danger" shape="rounded">
                    {text.headBlocker}
                </Badge>
            )}
            {node.role === "intermediate" && (
                <Badge appearance="tint" color="warning" shape="rounded">
                    {text.intermediate}
                </Badge>
            )}
            {client && <span className={mergeClasses(classes.client)}>{client}</span>}
        </span>
    );
};

const StateCell = ({ node, observedAt }: { node: BlockingNode; observedAt: Date }) => {
    const classes = useStyles();
    const status = node.request?.status ?? node.idleSession?.status ?? "";
    const idleSince = node.idleSession?.lastRequestEndTime;
    const ageMs =
        node.request?.elapsedMs ??
        (idleSince ? Math.max(0, observedAt.getTime() - Date.parse(idleSince)) : undefined);
    return (
        <span className={classes.state}>
            <Text>{status ? status.charAt(0).toUpperCase() + status.slice(1) : "—"}</Text>
            {ageMs !== undefined && (
                <Caption1 className={classes.note}>{formatElapsed(ageMs)}</Caption1>
            )}
        </span>
    );
};
