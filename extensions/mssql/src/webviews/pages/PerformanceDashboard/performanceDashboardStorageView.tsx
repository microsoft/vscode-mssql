/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Caption1, makeStyles, tokens } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import type { TableStorage } from "../../../sharedInterfaces/performance";
import {
    GetResourceCpuRequest,
    GetStorageRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { isFirstLoad, useExtensionRequest } from "../../common/useExtensionRequest";
import { formatMegabytes } from "./performanceDashboardFormat";
import { metrics, simpleMetricColumn, simpleTextColumn } from "./performanceDashboardMetrics";
import { PanelProps } from "./performanceDashboardPanels";
import {
    SectionHeader,
    StatusBar,
    ChartCard,
    TimeSeriesChart,
    TimeSeriesPoint,
    readData,
} from "./performanceDashboardParts";
import { usePolling, useRefresh } from "./performanceDashboardRefresh";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { bucketMinutesFor, resourceCpuPoints, resourceStorage } from "./performanceDashboardSeries";
import { SimpleGrid } from "./performanceDashboardSimpleGrid";
import { TableSkeleton } from "./performanceDashboardSkeletons";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useViewTimeRange } from "./performanceDashboardTimeRange";

/** The tables of the largest tables grid. */
const tableCount = 10;
/** The samples of the size that the chart keeps while the view is open: one each minute for a day. */
const maxSamples = 24 * 60;
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
});

/** A size in MB, in MB or GB. */
function formatSize(megabytes: number): string {
    return formatMegabytes(megabytes * 1024);
}

/**
 * The storage of the database: the size of its data files, the space used, and the limit; the
 * data size over time; and the largest tables. Azure SQL Database keeps about 14 days of size
 * history in master. Elsewhere there is no history, so the chart has the sizes read while the
 * view is open.
 */
export const PerformanceDashboardStorageView = ({ facts }: PanelProps) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const { range } = useViewTimeRange();
    const hasHistory = facts?.platform === "azureSqlDatabase";
    const tick = usePolling(sampleMs);
    const key = [databaseName, refreshKey];

    const storage = useExtensionRequest(
        GetStorageRequest.type,
        { top: tableCount },
        key,
        true,
        hasHistory ? undefined : tick,
    );
    const history = useExtensionRequest(
        GetResourceCpuRequest.type,
        { startUtc: range.from.toISOString(), endUtc: range.to.toISOString() },
        key,
        hasHistory,
    );
    const [samples, setSamples] = useState<TimeSeriesPoint[]>([]);
    useEffect(() => setSamples([]), [databaseName]);

    const data = readData(storage);
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

    const points = hasHistory
        ? resourceCpuPoints(
              readData(history) ?? [],
              range,
              bucketMinutesFor(range),
              resourceStorage,
          )
        : samples;

    return (
        <div className={classes.view}>
            <ChartCard
                label={text.allocatedSize}
                value={data ? formatSize(data.allocatedMb) : text.notAvailable}
                figures={[
                    {
                        label: text.usedSize,
                        value: data ? formatSize(data.usedMb) : text.notAvailable,
                    },
                    ...(isFirstLoad(storage) || data?.maxSizeMb !== undefined
                        ? [
                              {
                                  label: text.maxSizeLabel,
                                  value:
                                      data?.maxSizeMb !== undefined
                                          ? formatSize(data.maxSizeMb)
                                          : text.notAvailable,
                              },
                          ]
                        : []),
                ]}
                unit={text.dataSize}
                loading={isFirstLoad(storage)}>
                <TimeSeriesChart
                    compact
                    title={text.dataSize}
                    range={hasHistory ? range : undefined}
                    points={points}
                    format={formatSize}
                    read={hasHistory ? history : undefined}
                    message={hasHistory ? readStatusMessage(history) : undefined}
                />
            </ChartCard>
            <SectionHeader title={text.largestTables} />
            {isFirstLoad(storage) ? (
                <TableSkeleton numberColumns={2} />
            ) : data && data.tables.length > 0 ? (
                <SimpleGrid<TableStorage>
                    fill
                    items={data.tables}
                    getRowId={(table) => `${table.schemaName}.${table.tableName}`}
                    ariaLabel={text.largestTables}
                    columns={[
                        simpleTextColumn<TableStorage>(
                            "schema",
                            text.schemaName,
                            (table) => table.schemaName,
                            140,
                        ),
                        simpleTextColumn<TableStorage>(
                            "table",
                            text.tableName,
                            (table) => table.tableName,
                            260,
                        ),
                        simpleMetricColumn<TableStorage>(metrics.rows, {
                            id: "rows",
                            value: (table) => table.rowCount,
                        }),
                        simpleMetricColumn<TableStorage>(metrics.usedSize, {
                            id: "used",
                            value: (table) => table.usedMb,
                        }),
                    ]}
                />
            ) : (
                data && <Caption1 className={classes.note}>{text.noTables}</Caption1>
            )}
        </div>
    );
};
