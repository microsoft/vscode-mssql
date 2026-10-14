/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Caption1,
    makeStyles,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    PositioningVirtualElement,
    SearchBox,
    tokens,
} from "@fluentui/react-components";
import {
    CodeRegular,
    MoreHorizontalRegular,
    PlayRegular,
    TableRegular,
} from "@fluentui/react-icons";
import { useEffect, useMemo, useState } from "react";
import type { TableStorage } from "../../../sharedInterfaces/performance";
import {
    GetResourceCpuRequest,
    GetStorageRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
    ScriptTableCreateRequest,
    SelectTableTop1000Request,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { isFirstLoad, useExtensionRequest } from "../../common/useExtensionRequest";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { formatNumber, formatStorageSize as formatSize } from "./performanceDashboardFormat";
import { PanelProps, usePlatformMetric } from "./performanceDashboardPanels";
import {
    SectionHeader,
    StatusBar,
    TimeSeriesChart,
    TimeSeriesPoint,
    readData,
} from "./performanceDashboardParts";
import { usePolling, useRefresh } from "./performanceDashboardRefresh";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { bucketMinutesFor, resourceCpuPoints, resourceStorage } from "./performanceDashboardSeries";
import { SimpleGrid, SimpleGridColumn } from "./performanceDashboardSimpleGrid";
import { TableSkeleton, ValueSkeleton } from "./performanceDashboardSkeletons";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useViewTimeRange } from "./performanceDashboardTimeRange";

/** A row menu: at the pointer for a right-click, or under the row's actions button. */
interface TableMenu {
    readonly table: TableStorage;
    /**
     * Where the menu opens: a fixed rectangle, not the button. The virtualized grid recreates its
     * rows when the view renders, which would detach the button and move the menu to the corner.
     */
    readonly target: PositioningVirtualElement;
    /** True for the actions button, whose menu lines up with its end. */
    readonly fromButton: boolean;
}

/** A positioning target at a fixed rectangle. */
function fixedTarget(rect: DOMRect): PositioningVirtualElement {
    return { getBoundingClientRect: () => rect };
}

/** The samples of the size that the chart keeps while the view is open: one each minute for a day. */
const maxSamples = 24 * 60;
/** The tables that the list shows at most. */
const maxListedTables = 50;
const sampleMs = 60_000;

const useStyles = makeStyles({
    view: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        flex: "1 0 auto",
    },
    note: {
        color: tokens.colorNeutralForeground3,
    },
    card: {
        border: "1px solid var(--vscode-panel-border)",
        borderRadius: tokens.borderRadiusMedium,
    },
    summary: {
        padding: "20px 24px",
    },
    summaryLine: {
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "8px 24px",
    },
    headline: {
        display: "flex",
        alignItems: "baseline",
        flexWrap: "wrap",
        gap: "12px",
    },
    headlineValue: {
        fontSize: "28px",
        fontWeight: tokens.fontWeightSemibold,
    },
    secondary: {
        color: tokens.colorNeutralForeground3,
    },
    progress: {
        height: "12px",
        marginTop: "16px",
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground3,
        overflow: "hidden",
    },
    progressUsed: {
        height: "100%",
        backgroundColor: tokens.colorBrandBackground,
    },
    legend: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginTop: "12px",
        color: tokens.colorNeutralForeground3,
    },
    swatch: {
        width: "12px",
        height: "12px",
        borderRadius: tokens.borderRadiusSmall,
        backgroundColor: tokens.colorBrandBackground,
    },
    chart: {
        borderTop: "1px solid var(--vscode-panel-border)",
        padding: "12px 16px 4px 8px",
    },
    search: {
        width: "240px",
    },
    table: {
        display: "flex",
        alignItems: "center",
        minWidth: 0,
        gap: "8px",
    },
    tableIcon: {
        flexShrink: 0,
        color: tokens.colorNeutralForeground3,
    },
    schema: {
        color: tokens.colorNeutralForeground3,
    },
    tableName: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    sizeCell: {
        display: "block",
        position: "relative",
        width: "100%",
        textAlign: "right",
    },
    sizeBar: {
        position: "absolute",
        top: "-8px",
        bottom: "-8px",
        left: 0,
        backgroundColor: tokens.colorBrandBackground,
        opacity: 0.2,
    },
    sizeText: {
        position: "relative",
    },
});

/**
 * The storage of the database: the size of its data files, the space used, and the limit; the
 * data size over time; and all user tables. Azure SQL Database keeps about 14 days of size
 * history in master. Elsewhere there is no history, so the chart has the sizes read while the
 * view is open.
 */
export const PerformanceDashboardStorageView = ({ facts }: PanelProps) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { extensionRpc } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const { range } = useViewTimeRange();
    const [menu, setMenu] = useState<TableMenu | undefined>(undefined);
    const runTableScript = (table: TableStorage, create: boolean) =>
        void extensionRpc.sendRequest(
            create ? ScriptTableCreateRequest.type : SelectTableTop1000Request.type,
            { schemaName: table.schemaName, tableName: table.tableName },
        );
    const hasHistory = facts?.platform === "azureSqlDatabase";
    const tick = usePolling(sampleMs);
    const key = [databaseName, refreshKey];

    const storage = useExtensionRequest(
        GetStorageRequest.type,
        undefined,
        key,
        true,
        hasHistory ? undefined : tick,
    );
    // The size history: from the platform (Azure Monitor or Fabric) when it can be read, or else
    // from master on Azure SQL Database, or else the sizes read while the view is open.
    const platform = usePlatformMetric("storage", facts);
    const masterHistory = hasHistory && !platform.pending && !platform.series;
    const history = useExtensionRequest(
        GetResourceCpuRequest.type,
        { startUtc: range.from.toISOString(), endUtc: range.to.toISOString() },
        key,
        masterHistory,
    );
    const [samples, setSamples] = useState<TimeSeriesPoint[]>([]);
    const [search, setSearch] = useState("");
    useEffect(() => {
        setSamples([]);
        setSearch("");
    }, [databaseName]);

    const data = readData(storage);
    // The largest tables that match the search, at most the list size. The tables come largest
    // first, so the search covers every table and the list keeps the largest matches.
    const filteredTables = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        const matches = query
            ? (data?.tables ?? []).filter((table) =>
                  `${table.schemaName}.${table.tableName}`.toLocaleLowerCase().includes(query),
              )
            : (data?.tables ?? []);
        return matches.slice(0, maxListedTables);
    }, [data, search]);
    const largestUsedMb = data?.tables[0]?.usedMb ?? 0;
    const columns = useMemo<SimpleGridColumn<TableStorage>[]>(
        () => [
            {
                id: "table",
                header: text.tableName,
                idealWidth: 360,
                minWidth: 200,
                grow: true,
                compare: (a, b) =>
                    `${a.schemaName}.${a.tableName}`.localeCompare(
                        `${b.schemaName}.${b.tableName}`,
                    ),
                render: (table) => (
                    <span
                        className={classes.table}
                        title={`${table.schemaName}.${table.tableName}`}>
                        <TableRegular className={classes.tableIcon} />
                        <span className={classes.tableName}>
                            <span className={classes.schema}>{table.schemaName}.</span>
                            {table.tableName}
                        </span>
                    </span>
                ),
            },
            {
                id: "rows",
                header: text.rowCount,
                render: (table) => formatNumber(table.rowCount),
                compare: (a, b) => a.rowCount - b.rowCount,
                numeric: true,
                idealWidth: 120,
            },
            {
                id: "used",
                header: text.usedSize,
                render: (table) => (
                    <span className={classes.sizeCell}>
                        <span
                            className={classes.sizeBar}
                            style={{
                                width: `${largestUsedMb > 0 ? (table.usedMb / largestUsedMb) * 100 : 0}%`,
                            }}
                        />
                        <span className={classes.sizeText}>{formatSize(table.usedMb)}</span>
                    </span>
                ),
                compare: (a, b) => a.usedMb - b.usedMb,
                numeric: true,
                idealWidth: 160,
            },
            {
                id: "actions",
                header: "",
                render: (table) => (
                    <Button
                        appearance="subtle"
                        icon={<MoreHorizontalRegular />}
                        size="small"
                        aria-label={text.tableActions(`${table.schemaName}.${table.tableName}`)}
                        title={text.tableActions(`${table.schemaName}.${table.tableName}`)}
                        aria-haspopup="menu"
                        onClick={(event) =>
                            setMenu({
                                table,
                                target: fixedTarget(event.currentTarget.getBoundingClientRect()),
                                fromButton: true,
                            })
                        }
                    />
                ),
                idealWidth: 48,
                minWidth: 48,
                control: true,
            },
        ],
        [classes, largestUsedMb, text],
    );
    const observedAt =
        storage.result && "observedAtUtc" in storage.result
            ? storage.result.observedAtUtc
            : undefined;
    useEffect(() => {
        if (data && observedAt && !hasHistory) {
            setSamples((current) =>
                [...current, { x: new Date(observedAt), y: data.usedMb }].slice(-maxSamples),
            );
        }
        // One sample for each read: a read has a new result object.
    }, [data, observedAt, hasHistory]);

    const message = readStatusMessage(storage);
    if (message) {
        return <StatusBar message={message} />;
    }

    const points = platform.series
        ? platform.series.points
              .filter((point) => point.value !== null)
              .map((point) => ({ x: new Date(point.startUtc), y: point.value as number }))
        : masterHistory
          ? resourceCpuPoints(
                readData(history) ?? [],
                range,
                bucketMinutesFor(range),
                resourceStorage,
            )
          : samples;
    const rangedHistory = !!platform.series || masterHistory;

    return (
        <div className={classes.view}>
            <section className={classes.card} aria-busy={isFirstLoad(storage)}>
                <div className={classes.summary}>
                    <div className={classes.summaryLine}>
                        <div className={classes.headline}>
                            {isFirstLoad(storage) ? (
                                <ValueSkeleton width={120} height={32} />
                            ) : (
                                <span className={classes.headlineValue}>
                                    {data ? formatSize(data.usedMb) : text.notAvailable}
                                </span>
                            )}
                            <span className={classes.secondary}>
                                {data
                                    ? text.usedOfAllocated(formatSize(data.allocatedMb))
                                    : text.allocatedSize}
                            </span>
                        </div>
                        {data?.maxSizeMb !== undefined && (
                            <span className={classes.secondary}>
                                {text.canGrowTo(formatSize(data.maxSizeMb))}
                            </span>
                        )}
                    </div>
                    <div
                        className={classes.progress}
                        role="progressbar"
                        aria-label={text.usedSize}
                        aria-valuemin={0}
                        aria-valuemax={data?.allocatedMb ?? 0}
                        aria-valuenow={data?.usedMb ?? 0}>
                        <div
                            className={classes.progressUsed}
                            style={{
                                width: `${data?.allocatedMb ? Math.min(100, Math.max(0, (data.usedMb / data.allocatedMb) * 100)) : 0}%`,
                            }}
                        />
                    </div>
                    <div className={classes.legend}>
                        <span className={classes.swatch} />
                        {platform.series
                            ? text.unitWithSource(
                                  text.usedSize,
                                  platform.series.source === "fabric"
                                      ? text.sourceFabric
                                      : text.sourceAzureMonitor,
                              )
                            : text.usedSize}
                    </div>
                </div>
                <div className={classes.chart}>
                    <TimeSeriesChart
                        compact
                        title={text.usedSizeOverTime}
                        range={rangedHistory ? range : undefined}
                        points={points}
                        format={formatSize}
                        read={masterHistory ? history : undefined}
                        message={masterHistory ? readStatusMessage(history) : undefined}
                    />
                </div>
            </section>
            <SectionHeader
                title={text.tables}
                count={data ? text.tableCount(filteredTables.length) : undefined}
                action={
                    <SearchBox
                        className={classes.search}
                        size="small"
                        placeholder={text.searchTables}
                        aria-label={text.searchTables}
                        value={search}
                        onChange={(_event, value) => setSearch(value.value)}
                    />
                }
            />
            {isFirstLoad(storage) ? (
                <TableSkeleton numberColumns={4} />
            ) : data && filteredTables.length > 0 ? (
                <SimpleGrid<TableStorage>
                    fill
                    virtualized
                    items={filteredTables}
                    getRowId={(table) => JSON.stringify([table.schemaName, table.tableName])}
                    ariaLabel={text.tables}
                    defaultSort={{ column: "used", direction: "descending" }}
                    columns={columns}
                    onRowContextMenu={(table, event) => {
                        event.preventDefault();
                        const { clientX: x, clientY: y } = event;
                        setMenu({
                            table,
                            target: fixedTarget(new DOMRect(x, y, 0, 0)),
                            fromButton: false,
                        });
                    }}
                />
            ) : (
                data && (
                    <Caption1 className={classes.note}>
                        {search.trim() ? text.noMatchingTables : text.noTables}
                    </Caption1>
                )
            )}
            {menu && (
                <Menu
                    open
                    positioning={{
                        target: menu.target,
                        position: "below",
                        align: menu.fromButton ? "end" : "start",
                    }}
                    onOpenChange={(_event, state) => !state.open && setMenu(undefined)}>
                    <MenuPopover>
                        <MenuList>
                            <MenuItem
                                icon={<PlayRegular />}
                                onClick={() => runTableScript(menu.table, false)}>
                                {loc.searchDatabase.selectTop1000}
                            </MenuItem>
                            <MenuItem
                                icon={<CodeRegular />}
                                onClick={() => runTableScript(menu.table, true)}>
                                {text.scriptAsCreate}
                            </MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            )}
        </div>
    );
};
