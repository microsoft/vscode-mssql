/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSX, useMemo, useState } from "react";
import {
    Badge,
    Button,
    Card,
    SearchBox,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
} from "@fluentui/react-components";
import { Dismiss20Regular, Open20Regular } from "@fluentui/react-icons";
import { DashboardQuery } from "../../../../sharedInterfaces/serverDashboard";
import { formatDuration, formatNumber, getDashboardLoc, getTrendLabel } from "../dashboardLabels";

export interface QueriesTabProps {
    queries: DashboardQuery[];
    onNewQuery: () => void;
}

export function QueriesTab({ queries, onNewQuery }: QueriesTabProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const [searchValue, setSearchValue] = useState("");
    const [selectedQueryId, setSelectedQueryId] = useState<string>();
    const filteredQueries = useMemo(() => {
        const normalizedSearch = searchValue.trim().toLowerCase();
        if (!normalizedSearch) {
            return queries;
        }
        return queries.filter(
            (query) =>
                query.queryText.toLowerCase().includes(normalizedSearch) ||
                query.databaseName.toLowerCase().includes(normalizedSearch),
        );
    }, [queries, searchValue]);
    const selectedQuery = queries.find((query) => query.queryId === selectedQueryId);

    return (
        <div className="dashboard-tab-content">
            <div className="dashboard-section-heading">
                <div>
                    <Text as="h2" size={500} weight="semibold">
                        {dashboardLoc.topQueries}
                    </Text>
                    <Text className="dashboard-secondary-text">
                        {dashboardLoc.queriesRankedByExecutionTime}
                    </Text>
                </div>
                <Button appearance="primary" icon={<Open20Regular />} onClick={onNewQuery}>
                    {dashboardLoc.newQuery}
                </Button>
            </div>
            <SearchBox
                className="dashboard-search"
                value={searchValue}
                placeholder={dashboardLoc.filterQueryTextOrDatabase}
                aria-label={dashboardLoc.filterQueries}
                onChange={(_, data) => setSearchValue(data.value)}
            />

            <div className={selectedQuery ? "dashboard-split-view" : undefined}>
                <Card className="dashboard-table-card">
                    <div className="dashboard-table-scroll">
                        <Table aria-label={dashboardLoc.topQueries}>
                            <TableHeader>
                                <TableRow>
                                    <TableHeaderCell>{dashboardLoc.query}</TableHeaderCell>
                                    <TableHeaderCell>{dashboardLoc.executions}</TableHeaderCell>
                                    <TableHeaderCell>
                                        {dashboardLoc.averageDuration}
                                    </TableHeaderCell>
                                    <TableHeaderCell>{dashboardLoc.cpu}</TableHeaderCell>
                                    <TableHeaderCell>{dashboardLoc.logicalReads}</TableHeaderCell>
                                    <TableHeaderCell>{dashboardLoc.trend}</TableHeaderCell>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredQueries.map((query) => (
                                    <TableRow key={query.queryId}>
                                        <TableCell>
                                            <button
                                                type="button"
                                                className="dashboard-query-link"
                                                aria-label={dashboardLoc.showQueryDetails(
                                                    query.queryId,
                                                )}
                                                onClick={() => setSelectedQueryId(query.queryId)}>
                                                <span>{query.queryText}</span>
                                                <small>{query.databaseName}</small>
                                            </button>
                                        </TableCell>
                                        <TableCell>{formatNumber(query.executions)}</TableCell>
                                        <TableCell>
                                            {formatDuration(query.averageDurationMs)}
                                        </TableCell>
                                        <TableCell>{formatDuration(query.cpuMs)}</TableCell>
                                        <TableCell>{formatNumber(query.logicalReads)}</TableCell>
                                        <TableCell>
                                            <Badge
                                                appearance="tint"
                                                color={
                                                    query.trend === "regressing"
                                                        ? "warning"
                                                        : query.trend === "improving"
                                                          ? "success"
                                                          : "informative"
                                                }>
                                                {getTrendLabel(query.trend)}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    {filteredQueries.length === 0 ? (
                        <div className="dashboard-empty-state">
                            <Text>{dashboardLoc.noMatchingQueries}</Text>
                        </div>
                    ) : null}
                </Card>

                {selectedQuery ? (
                    <QueryDetailPanel
                        query={selectedQuery}
                        onClose={() => setSelectedQueryId(undefined)}
                    />
                ) : null}
            </div>
        </div>
    );
}

interface QueryDetailPanelProps {
    query: DashboardQuery;
    onClose: () => void;
}

function QueryDetailPanel({ query, onClose }: QueryDetailPanelProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    return (
        <aside className="dashboard-detail-panel" aria-label={dashboardLoc.queryDetails}>
            <div className="dashboard-detail-header">
                <div>
                    <Text as="h3" size={500} weight="semibold">
                        {dashboardLoc.queryDetails}
                    </Text>
                    <Text className="dashboard-secondary-text">{query.queryId}</Text>
                </div>
                <Button
                    appearance="transparent"
                    icon={<Dismiss20Regular />}
                    aria-label={dashboardLoc.closeQueryDetails}
                    onClick={onClose}
                />
            </div>
            <dl className="dashboard-detail-stats">
                <div>
                    <dt>{dashboardLoc.executions}</dt>
                    <dd>{formatNumber(query.executions)}</dd>
                </div>
                <div>
                    <dt>{dashboardLoc.averageDuration}</dt>
                    <dd>{formatDuration(query.averageDurationMs)}</dd>
                </div>
                <div>
                    <dt>{dashboardLoc.totalDuration}</dt>
                    <dd>{formatDuration(query.totalDurationMs)}</dd>
                </div>
                <div>
                    <dt>{dashboardLoc.logicalReads}</dt>
                    <dd>{formatNumber(query.logicalReads)}</dd>
                </div>
            </dl>
            <Text as="h4" weight="semibold">
                {dashboardLoc.queryText}
            </Text>
            <pre className="dashboard-code-block">
                <code>{query.queryText}</code>
            </pre>
            <Text className="dashboard-secondary-text">
                {dashboardLoc.lastExecuted(
                    new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "medium",
                    }).format(new Date(query.lastExecutionTime)),
                )}
            </Text>
        </aside>
    );
}
