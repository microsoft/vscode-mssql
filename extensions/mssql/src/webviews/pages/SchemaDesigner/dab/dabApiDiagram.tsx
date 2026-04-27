/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Card,
    Input,
    Text,
    makeStyles,
    mergeClasses,
    tokens,
} from "@fluentui/react-components";
import {
    ChevronDown16Regular,
    ChevronRight16Regular,
    Copy16Regular,
    Dismiss16Regular,
    Search16Regular,
} from "@fluentui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Dab } from "../../../../sharedInterfaces/dab";
import { locConstants } from "../../../common/locConstants";
import { useDabContext } from "./dabContext";
import {
    DabApiDiagramModel,
    DabGraphQLEntityDiagram,
    DabGraphQLOperation,
    DabMcpEntityDiagram,
    DabMcpToolDiagram,
    DabRestEntityDiagram,
    DabRestEndpoint,
    createDabApiDiagramModel,
    filterDabApiDiagramModel,
} from "./dabApiDiagramModel";

const ENTITY_LIST_MAX_HEIGHT_PX = 520;
const VIRTUAL_OVERSCAN = 6;

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        width: "100%",
        height: "100%",
        minHeight: 0,
        padding: "12px",
        overflow: "auto",
        backgroundColor: tokens.colorNeutralBackground1,
    },
    filterRow: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    searchInput: {
        maxWidth: "320px",
    },
    columns: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: "12px",
        alignItems: "start",
    },
    column: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        minWidth: 0,
    },
    card: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        padding: "14px",
        minWidth: 0,
    },
    columnHeader: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    columnTitleRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
    },
    columnTitle: {
        fontWeight: 600,
    },
    columnDescription: {
        color: tokens.colorNeutralForeground3,
        fontSize: "12px",
    },
    basePathRow: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minWidth: 0,
        padding: "8px 10px",
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    monoText: {
        fontFamily: tokens.fontFamilyMonospace,
    },
    basePathText: {
        flex: 1,
        minWidth: 0,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    countText: {
        color: tokens.colorNeutralForeground3,
        fontSize: "12px",
        whiteSpace: "nowrap",
    },
    entityCard: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "12px",
        minWidth: 0,
    },
    entityHeader: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "8px",
        minWidth: 0,
    },
    entityHeaderText: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        minWidth: 0,
        flex: 1,
    },
    entityHeaderActions: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        flexShrink: 0,
    },
    entityName: {
        fontWeight: 600,
    },
    entitySubtitle: {
        color: tokens.colorNeutralForeground3,
        fontSize: "12px",
    },
    rows: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        minWidth: 0,
    },
    row: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minWidth: 0,
        padding: "8px 10px",
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    rowTextGroup: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        flex: 1,
        minWidth: 0,
    },
    primaryText: {
        minWidth: 0,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    secondaryText: {
        color: tokens.colorNeutralForeground3,
        fontSize: "12px",
    },
    codeText: {
        fontFamily: tokens.fontFamilyMonospace,
    },
    pill: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2px 8px",
        borderRadius: tokens.borderRadiusSmall,
        fontSize: "11px",
        fontWeight: 600,
        whiteSpace: "nowrap",
        flexShrink: 0,
    },
    getPill: {
        backgroundColor: tokens.colorPaletteGreenBackground1,
        color: tokens.colorPaletteGreenForeground1,
    },
    postPill: {
        backgroundColor: tokens.colorBrandBackground2,
        color: tokens.colorBrandForeground1,
    },
    putPill: {
        backgroundColor: tokens.colorPaletteYellowBackground2,
        color: tokens.colorPaletteYellowForeground2,
    },
    patchPill: {
        backgroundColor: tokens.colorPaletteBerryBackground2,
        color: tokens.colorPaletteBerryForeground2,
    },
    deletePill: {
        backgroundColor: tokens.colorPaletteRedBackground1,
        color: tokens.colorPaletteRedForeground1,
    },
    queryPill: {
        backgroundColor: tokens.colorPaletteGreenBackground1,
        color: tokens.colorPaletteGreenForeground1,
    },
    mutationPill: {
        backgroundColor: tokens.colorPaletteBerryBackground2,
        color: tokens.colorPaletteBerryForeground2,
    },
    toolDot: {
        width: "8px",
        height: "8px",
        borderRadius: tokens.borderRadiusCircular,
        flexShrink: 0,
        backgroundColor: tokens.colorNeutralForegroundDisabled,
    },
    toolDotEnabled: {
        backgroundColor: tokens.colorStatusSuccessForeground1,
    },
    toolRowDisabled: {
        opacity: 0.6,
    },
    sectionHeading: {
        fontSize: "12px",
        fontWeight: 600,
        color: tokens.colorNeutralForeground3,
        textTransform: "uppercase",
    },
    actionPills: {
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
    },
    actionPill: {
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: tokens.borderRadiusSmall,
        backgroundColor: tokens.colorNeutralBackground2,
        color: tokens.colorNeutralForeground2,
        fontSize: "12px",
    },
    emptyState: {
        color: tokens.colorNeutralForeground3,
        fontSize: "12px",
    },
    virtualizedList: {
        position: "relative",
        overflowY: "auto",
        minHeight: "220px",
        maxHeight: `min(60vh, ${ENTITY_LIST_MAX_HEIGHT_PX}px)`,
        paddingRight: "4px",
    },
    virtualTrack: {
        position: "relative",
        width: "100%",
    },
    virtualItem: {
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        paddingBottom: "8px",
        boxSizing: "border-box",
    },
    highlight: {
        backgroundColor: tokens.colorBrandBackground2,
        color: tokens.colorNeutralForeground1,
        borderRadius: tokens.borderRadiusSmall,
        padding: "0 1px",
    },
});

function getRestOperationLabel(operation: DabRestEndpoint["operation"]): string {
    switch (operation) {
        case Dab.EntityAction.Read:
            return locConstants.schemaDesigner.apiDiagramListAll;
        case "readById":
            return locConstants.schemaDesigner.apiDiagramGetById;
        case Dab.EntityAction.Create:
            return locConstants.schemaDesigner.create;
        case Dab.EntityAction.Update:
            return locConstants.schemaDesigner.apiDiagramReplaceOrUpdate;
        case Dab.EntityAction.Delete:
            return locConstants.common.delete;
    }
}

function getGraphQLOperationLabel(operation: DabGraphQLOperation["operation"]): string {
    switch (operation) {
        case Dab.EntityAction.Read:
            return locConstants.schemaDesigner.apiDiagramListAll;
        case "readById":
            return locConstants.schemaDesigner.apiDiagramGetById;
        case Dab.EntityAction.Create:
            return locConstants.schemaDesigner.create;
        case Dab.EntityAction.Update:
            return locConstants.schemaDesigner.update;
        case Dab.EntityAction.Delete:
            return locConstants.common.delete;
    }
}

function getMcpToolDescription(name: DabMcpToolDiagram["name"]): string {
    switch (name) {
        case "describe_entities":
            return locConstants.schemaDesigner.apiDiagramDescribeEntities;
        case "read_records":
            return locConstants.schemaDesigner.apiDiagramReadRecords;
        case "create_record":
            return locConstants.schemaDesigner.apiDiagramCreateRecord;
        case "update_record":
            return locConstants.schemaDesigner.apiDiagramUpdateRecord;
        case "delete_record":
            return locConstants.schemaDesigner.apiDiagramDeleteRecord;
        case "execute_entity":
            return locConstants.schemaDesigner.apiDiagramExecuteEntity;
    }
}

function getActionLabel(action: Dab.EntityAction): string {
    switch (action) {
        case Dab.EntityAction.Create:
            return locConstants.schemaDesigner.create;
        case Dab.EntityAction.Read:
            return locConstants.schemaDesigner.read;
        case Dab.EntityAction.Update:
            return locConstants.schemaDesigner.update;
        case Dab.EntityAction.Delete:
            return locConstants.common.delete;
    }
}

function renderHighlightedText(
    value: string,
    query: string,
    highlightClassName: string,
): ReactNode {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return value;
    }

    const normalizedValue = value.toLowerCase();
    const nodes: ReactNode[] = [];
    let currentIndex = 0;
    let matchIndex = normalizedValue.indexOf(normalizedQuery, currentIndex);

    if (matchIndex < 0) {
        return value;
    }

    while (matchIndex >= 0) {
        if (matchIndex > currentIndex) {
            nodes.push(value.slice(currentIndex, matchIndex));
        }

        const matchEnd = matchIndex + normalizedQuery.length;
        nodes.push(
            <span key={`${matchIndex}-${matchEnd}`} className={highlightClassName}>
                {value.slice(matchIndex, matchEnd)}
            </span>,
        );

        currentIndex = matchEnd;
        matchIndex = normalizedValue.indexOf(normalizedQuery, currentIndex);
    }

    if (currentIndex < value.length) {
        nodes.push(value.slice(currentIndex));
    }

    return nodes;
}

function CopyButton({ ariaLabel, text }: { ariaLabel: string; text: string }) {
    const { copyToClipboard } = useDabContext();

    return (
        <Button
            size="small"
            appearance="subtle"
            icon={<Copy16Regular />}
            aria-label={ariaLabel}
            title={ariaLabel}
            onClick={() => copyToClipboard(text, Dab.CopyTextType.Url)}
        />
    );
}

function EntityToggleButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
    const ariaLabel = collapsed ? locConstants.common.expand : locConstants.common.collapse;

    return (
        <Button
            size="small"
            appearance="subtle"
            icon={collapsed ? <ChevronRight16Regular /> : <ChevronDown16Regular />}
            aria-label={ariaLabel}
            title={ariaLabel}
            onClick={onClick}
        />
    );
}

function ColumnHeader({
    title,
    description,
    basePath,
    count,
    query,
}: {
    title: string;
    description: string;
    basePath: string;
    count: string;
    query: string;
}) {
    const classes = useStyles();

    return (
        <div className={classes.columnHeader}>
            <div className={classes.columnTitleRow}>
                <Text className={classes.columnTitle}>{title}</Text>
                <Text className={classes.countText}>{count}</Text>
            </div>
            <Text className={classes.columnDescription}>{description}</Text>
            <div className={classes.basePathRow}>
                <Text className={classes.countText}>
                    {locConstants.schemaDesigner.apiDiagramBasePath}
                </Text>
                <Text className={mergeClasses(classes.basePathText, classes.monoText)}>
                    {renderHighlightedText(basePath, query, classes.highlight)}
                </Text>
                <CopyButton
                    ariaLabel={locConstants.schemaDesigner.copyUrl(title)}
                    text={basePath}
                />
            </div>
        </div>
    );
}

function EmptyState({ message }: { message: string }) {
    const classes = useStyles();

    return <Text className={classes.emptyState}>{message}</Text>;
}

function RestRow({ endpoint, query }: { endpoint: DabRestEndpoint; query: string }) {
    const classes = useStyles();
    const pillClassName = {
        GET: classes.getPill,
        POST: classes.postPill,
        PUT: classes.putPill,
        PATCH: classes.patchPill,
        DELETE: classes.deletePill,
    }[endpoint.method];

    return (
        <div className={classes.row}>
            <span className={mergeClasses(classes.pill, pillClassName)}>{endpoint.method}</span>
            <div className={classes.rowTextGroup}>
                <Text className={mergeClasses(classes.primaryText, classes.codeText)}>
                    {renderHighlightedText(endpoint.path, query, classes.highlight)}
                </Text>
                <Text className={classes.secondaryText}>
                    {renderHighlightedText(
                        getRestOperationLabel(endpoint.operation),
                        query,
                        classes.highlight,
                    )}
                </Text>
            </div>
        </div>
    );
}

function GraphQLRow({ operation, query }: { operation: DabGraphQLOperation; query: string }) {
    const classes = useStyles();
    const pillClassName = operation.kind === "query" ? classes.queryPill : classes.mutationPill;

    return (
        <div className={classes.row}>
            <span className={mergeClasses(classes.pill, pillClassName)}>{operation.kind}</span>
            <div className={classes.rowTextGroup}>
                <Text className={mergeClasses(classes.primaryText, classes.codeText)}>
                    {renderHighlightedText(operation.name, query, classes.highlight)}
                </Text>
                <Text className={classes.secondaryText}>
                    {renderHighlightedText(
                        getGraphQLOperationLabel(operation.operation),
                        query,
                        classes.highlight,
                    )}
                </Text>
            </div>
        </div>
    );
}

function McpToolRow({
    tool,
    query,
    showDisabledMessage = true,
}: {
    tool: DabMcpToolDiagram;
    query: string;
    showDisabledMessage?: boolean;
}) {
    const classes = useStyles();

    return (
        <div className={mergeClasses(classes.row, !tool.enabled && classes.toolRowDisabled)}>
            <div
                className={mergeClasses(classes.toolDot, tool.enabled && classes.toolDotEnabled)}
            />
            <div className={classes.rowTextGroup}>
                <Text className={mergeClasses(classes.primaryText, classes.codeText)}>
                    {renderHighlightedText(tool.name, query, classes.highlight)}
                </Text>
                <Text className={classes.secondaryText}>
                    {renderHighlightedText(
                        getMcpToolDescription(tool.name),
                        query,
                        classes.highlight,
                    )}
                </Text>
            </div>
            {!tool.enabled && showDisabledMessage && (
                <Text className={classes.secondaryText}>
                    {locConstants.schemaDesigner.apiDiagramUnavailable}
                </Text>
            )}
        </div>
    );
}

function RestEntityCard({
    entity,
    query,
    collapsed,
    onToggle,
}: {
    entity: DabRestEntityDiagram;
    query: string;
    collapsed: boolean;
    onToggle: () => void;
}) {
    const classes = useStyles();

    return (
        <Card className={classes.entityCard}>
            <div className={classes.entityHeader}>
                <div className={classes.entityHeaderText}>
                    <Text className={classes.entityName}>
                        {renderHighlightedText(entity.entityName, query, classes.highlight)}
                    </Text>
                    <Text className={classes.entitySubtitle}>
                        {renderHighlightedText(
                            locConstants.schemaDesigner.apiDiagramSource(
                                entity.schemaName,
                                entity.tableName,
                            ),
                            query,
                            classes.highlight,
                        )}
                    </Text>
                </div>
                <div className={classes.entityHeaderActions}>
                    <Text className={classes.countText}>
                        {locConstants.schemaDesigner.apiDiagramOperationsCount(
                            entity.endpoints.length,
                        )}
                    </Text>
                    <CopyButton
                        ariaLabel={locConstants.schemaDesigner.copyUrl(entity.basePath)}
                        text={entity.basePath}
                    />
                    <EntityToggleButton collapsed={collapsed} onClick={onToggle} />
                </div>
            </div>
            {!collapsed && (
                <div className={classes.rows}>
                    {entity.endpoints.map((endpoint) => (
                        <RestRow
                            key={`${endpoint.method}-${endpoint.path}`}
                            endpoint={endpoint}
                            query={query}
                        />
                    ))}
                </div>
            )}
        </Card>
    );
}

function GraphQLEntityCard({
    entity,
    query,
    collapsed,
    onToggle,
}: {
    entity: DabGraphQLEntityDiagram;
    query: string;
    collapsed: boolean;
    onToggle: () => void;
}) {
    const classes = useStyles();
    const queryCount = entity.operations.filter((operation) => operation.kind === "query").length;
    const mutationCount = entity.operations.filter(
        (operation) => operation.kind === "mutation",
    ).length;

    return (
        <Card className={classes.entityCard}>
            <div className={classes.entityHeader}>
                <div className={classes.entityHeaderText}>
                    <Text className={classes.entityName}>
                        {renderHighlightedText(entity.entityName, query, classes.highlight)}
                    </Text>
                    <Text className={classes.entitySubtitle}>
                        {renderHighlightedText(
                            locConstants.schemaDesigner.apiDiagramGraphQLTypes(
                                entity.singularName,
                                entity.pluralName,
                            ),
                            query,
                            classes.highlight,
                        )}
                    </Text>
                </div>
                <div className={classes.entityHeaderActions}>
                    <Text className={classes.countText}>
                        {locConstants.schemaDesigner.apiDiagramGraphQLCount(
                            queryCount,
                            mutationCount,
                        )}
                    </Text>
                    <EntityToggleButton collapsed={collapsed} onClick={onToggle} />
                </div>
            </div>
            {!collapsed && (
                <div className={classes.rows}>
                    {entity.operations.map((operation) => (
                        <GraphQLRow
                            key={`${operation.kind}-${operation.name}`}
                            operation={operation}
                            query={query}
                        />
                    ))}
                </div>
            )}
        </Card>
    );
}

function McpEntityCard({
    entity,
    query,
    collapsed,
    onToggle,
}: {
    entity: DabMcpEntityDiagram;
    query: string;
    collapsed: boolean;
    onToggle: () => void;
}) {
    const classes = useStyles();

    return (
        <Card className={classes.entityCard}>
            <div className={classes.entityHeader}>
                <div className={classes.entityHeaderText}>
                    <Text className={classes.entityName}>
                        {renderHighlightedText(entity.entityName, query, classes.highlight)}
                    </Text>
                    <Text className={classes.entitySubtitle}>
                        {renderHighlightedText(
                            locConstants.schemaDesigner.apiDiagramSource(
                                entity.schemaName,
                                entity.tableName,
                            ),
                            query,
                            classes.highlight,
                        )}
                    </Text>
                </div>
                <div className={classes.entityHeaderActions}>
                    <Text className={classes.countText}>
                        {locConstants.schemaDesigner.apiDiagramToolsCount(entity.tools.length)}
                    </Text>
                    <EntityToggleButton collapsed={collapsed} onClick={onToggle} />
                </div>
            </div>
            {!collapsed && (
                <div className={classes.rows}>
                    {entity.tools.map((tool) => (
                        <McpToolRow
                            key={`${entity.id}-${tool.name}`}
                            tool={tool}
                            query={query}
                            showDisabledMessage={false}
                        />
                    ))}
                </div>
            )}
        </Card>
    );
}

function getCollapsedMeasureKey(collapsedById: Record<string, boolean>): string {
    return Object.keys(collapsedById)
        .filter((id) => collapsedById[id])
        .sort()
        .join(",");
}

function VirtualizedEntityList<T extends { id: string }>({
    items,
    estimateSize,
    remeasureKey,
    renderItem,
}: {
    items: readonly T[];
    estimateSize: number;
    remeasureKey: string;
    renderItem: (item: T) => ReactNode;
}) {
    const classes = useStyles();
    const parentRef = useRef<HTMLDivElement | null>(null);
    const virtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => estimateSize,
        overscan: VIRTUAL_OVERSCAN,
    });

    useEffect(() => {
        virtualizer.measure();
    }, [remeasureKey, virtualizer]);

    return (
        <div ref={parentRef} className={classes.virtualizedList}>
            <div
                className={classes.virtualTrack}
                style={{ height: `${virtualizer.getTotalSize()}px` }}>
                {virtualizer.getVirtualItems().map((virtualItem) => {
                    const item = items[virtualItem.index];
                    return (
                        <div
                            key={item.id}
                            ref={virtualizer.measureElement}
                            className={classes.virtualItem}
                            data-index={virtualItem.index}
                            style={{ transform: `translateY(${virtualItem.start}px)` }}>
                            {renderItem(item)}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function RestColumn({
    model,
    filteredModel,
    query,
    collapsedEntityIds,
    onToggleEntity,
}: {
    model: DabApiDiagramModel;
    filteredModel: DabApiDiagramModel;
    query: string;
    collapsedEntityIds: Record<string, boolean>;
    onToggleEntity: (entityId: string) => void;
}) {
    const classes = useStyles();

    return (
        <div className={classes.column}>
            <Card className={classes.card}>
                <ColumnHeader
                    title={locConstants.schemaDesigner.restApiEndpoints}
                    description={locConstants.schemaDesigner.apiDiagramRestDescription}
                    basePath={filteredModel.rest.basePath}
                    count={locConstants.schemaDesigner.apiDiagramEntitiesCount(
                        model.rest.entities.length,
                    )}
                    query={query}
                />
                {!filteredModel.rest.enabled ? (
                    <EmptyState
                        message={locConstants.schemaDesigner.apiDiagramDisabled(
                            locConstants.schemaDesigner.restApi,
                        )}
                    />
                ) : filteredModel.rest.entities.length > 0 ? (
                    <VirtualizedEntityList
                        items={filteredModel.rest.entities}
                        estimateSize={188}
                        remeasureKey={`${filteredModel.rest.entities.length}:${getCollapsedMeasureKey(
                            collapsedEntityIds,
                        )}:${query}`}
                        renderItem={(entity) => (
                            <RestEntityCard
                                entity={entity}
                                query={query}
                                collapsed={Boolean(collapsedEntityIds[entity.id])}
                                onToggle={() => onToggleEntity(entity.id)}
                            />
                        )}
                    />
                ) : (
                    <EmptyState
                        message={
                            model.rest.entities.length > 0
                                ? locConstants.schemaDesigner.apiDiagramNoMatches
                                : locConstants.schemaDesigner.apiDiagramNoEnabledEntities
                        }
                    />
                )}
            </Card>
        </div>
    );
}

function GraphQLColumn({
    model,
    filteredModel,
    query,
    collapsedEntityIds,
    onToggleEntity,
}: {
    model: DabApiDiagramModel;
    filteredModel: DabApiDiagramModel;
    query: string;
    collapsedEntityIds: Record<string, boolean>;
    onToggleEntity: (entityId: string) => void;
}) {
    const classes = useStyles();

    return (
        <div className={classes.column}>
            <Card className={classes.card}>
                <ColumnHeader
                    title={locConstants.schemaDesigner.graphql}
                    description={locConstants.schemaDesigner.apiDiagramGraphQLDescription}
                    basePath={filteredModel.graphql.basePath}
                    count={locConstants.schemaDesigner.apiDiagramEntitiesCount(
                        model.graphql.entities.length,
                    )}
                    query={query}
                />
                {!filteredModel.graphql.enabled ? (
                    <EmptyState
                        message={locConstants.schemaDesigner.apiDiagramDisabled(
                            locConstants.schemaDesigner.graphql,
                        )}
                    />
                ) : filteredModel.graphql.entities.length > 0 ? (
                    <VirtualizedEntityList
                        items={filteredModel.graphql.entities}
                        estimateSize={180}
                        remeasureKey={`${filteredModel.graphql.entities.length}:${getCollapsedMeasureKey(
                            collapsedEntityIds,
                        )}:${query}`}
                        renderItem={(entity) => (
                            <GraphQLEntityCard
                                entity={entity}
                                query={query}
                                collapsed={Boolean(collapsedEntityIds[entity.id])}
                                onToggle={() => onToggleEntity(entity.id)}
                            />
                        )}
                    />
                ) : (
                    <EmptyState
                        message={
                            model.graphql.entities.length > 0
                                ? locConstants.schemaDesigner.apiDiagramNoMatches
                                : locConstants.schemaDesigner.apiDiagramNoEnabledEntities
                        }
                    />
                )}
            </Card>
        </div>
    );
}

function McpColumn({
    model,
    filteredModel,
    query,
    collapsedEntityIds,
    onToggleEntity,
}: {
    model: DabApiDiagramModel;
    filteredModel: DabApiDiagramModel;
    query: string;
    collapsedEntityIds: Record<string, boolean>;
    onToggleEntity: (entityId: string) => void;
}) {
    const classes = useStyles();

    return (
        <div className={classes.column}>
            <Card className={classes.card}>
                <ColumnHeader
                    title={locConstants.schemaDesigner.mcp}
                    description={locConstants.schemaDesigner.apiDiagramMcpDescription}
                    basePath={filteredModel.mcp.basePath}
                    count={locConstants.schemaDesigner.apiDiagramToolsCount(model.mcp.tools.length)}
                    query={query}
                />
                {!filteredModel.mcp.enabled ? (
                    <EmptyState
                        message={locConstants.schemaDesigner.apiDiagramDisabled(
                            locConstants.schemaDesigner.mcp,
                        )}
                    />
                ) : (
                    <>
                        <Text className={classes.sectionHeading}>
                            {locConstants.schemaDesigner.apiDiagramBuiltInTools}
                        </Text>
                        <div className={classes.rows}>
                            {filteredModel.mcp.tools.length > 0 ? (
                                filteredModel.mcp.tools.map((tool) => (
                                    <McpToolRow key={tool.name} tool={tool} query={query} />
                                ))
                            ) : (
                                <EmptyState
                                    message={locConstants.schemaDesigner.apiDiagramNoMatches}
                                />
                            )}
                        </div>

                        <Text className={classes.sectionHeading}>
                            {locConstants.schemaDesigner.apiDiagramPerEntity}
                        </Text>
                        {filteredModel.mcp.entities.length > 0 ? (
                            <VirtualizedEntityList
                                items={filteredModel.mcp.entities}
                                estimateSize={168}
                                remeasureKey={`${filteredModel.mcp.entities.length}:${getCollapsedMeasureKey(
                                    collapsedEntityIds,
                                )}:${query}`}
                                renderItem={(entity) => (
                                    <McpEntityCard
                                        entity={entity}
                                        query={query}
                                        collapsed={Boolean(collapsedEntityIds[entity.id])}
                                        onToggle={() => onToggleEntity(entity.id)}
                                    />
                                )}
                            />
                        ) : (
                            <EmptyState
                                message={
                                    model.mcp.entities.length > 0
                                        ? locConstants.schemaDesigner.apiDiagramNoMatches
                                        : locConstants.schemaDesigner.apiDiagramNoEnabledEntities
                                }
                            />
                        )}

                        <Text className={classes.sectionHeading}>
                            {locConstants.schemaDesigner.apiDiagramScope}
                        </Text>
                        <Text className={classes.secondaryText}>
                            {renderHighlightedText(
                                locConstants.schemaDesigner.apiDiagramScopeSummary(
                                    model.mcp.enabledEntityCount,
                                    model.mcp.enabledActions
                                        .map((action) => getActionLabel(action))
                                        .join(", "),
                                ),
                                query,
                                classes.highlight,
                            )}
                        </Text>
                        <div className={classes.actionPills}>
                            {model.mcp.enabledActions.map((action) => (
                                <span key={action} className={classes.actionPill}>
                                    {renderHighlightedText(
                                        getActionLabel(action),
                                        query,
                                        classes.highlight,
                                    )}
                                </span>
                            ))}
                        </div>
                    </>
                )}
            </Card>
        </div>
    );
}

function toggleCollapsedEntityState(
    entityId: string,
    collapsedById: Record<string, boolean>,
): Record<string, boolean> {
    return {
        ...collapsedById,
        [entityId]: !collapsedById[entityId],
    };
}

export function DabApiDiagram() {
    const classes = useStyles();
    const { dabConfig } = useDabContext();
    const [filterText, setFilterText] = useState("");
    const [collapsedRestEntities, setCollapsedRestEntities] = useState<Record<string, boolean>>({});
    const [collapsedGraphQLEntities, setCollapsedGraphQLEntities] = useState<
        Record<string, boolean>
    >({});
    const [collapsedMcpEntities, setCollapsedMcpEntities] = useState<Record<string, boolean>>({});

    const model = useMemo(
        () => (dabConfig ? createDabApiDiagramModel(dabConfig) : null),
        [dabConfig],
    );
    const filteredModel = useMemo(
        () => (model ? filterDabApiDiagramModel(model, filterText) : null),
        [filterText, model],
    );
    const normalizedQuery = filterText.trim();

    if (!model || !filteredModel) {
        return null;
    }

    return (
        <div className={classes.root}>
            <div className={classes.filterRow}>
                <Input
                    className={classes.searchInput}
                    size="small"
                    placeholder={locConstants.schemaDesigner.apiDiagramFilter}
                    aria-label={locConstants.schemaDesigner.apiDiagramFilter}
                    value={filterText}
                    onChange={(_, data) => setFilterText(data.value)}
                    contentBefore={<Search16Regular />}
                    contentAfter={
                        filterText ? (
                            <Button
                                appearance="transparent"
                                icon={<Dismiss16Regular />}
                                size="small"
                                aria-label={locConstants.common.clear}
                                onClick={() => setFilterText("")}
                            />
                        ) : null
                    }
                />
            </div>
            <div className={classes.columns}>
                <RestColumn
                    model={model}
                    filteredModel={filteredModel}
                    query={normalizedQuery}
                    collapsedEntityIds={collapsedRestEntities}
                    onToggleEntity={(entityId) =>
                        setCollapsedRestEntities((current) =>
                            toggleCollapsedEntityState(entityId, current),
                        )
                    }
                />
                <GraphQLColumn
                    model={model}
                    filteredModel={filteredModel}
                    query={normalizedQuery}
                    collapsedEntityIds={collapsedGraphQLEntities}
                    onToggleEntity={(entityId) =>
                        setCollapsedGraphQLEntities((current) =>
                            toggleCollapsedEntityState(entityId, current),
                        )
                    }
                />
                <McpColumn
                    model={model}
                    filteredModel={filteredModel}
                    query={normalizedQuery}
                    collapsedEntityIds={collapsedMcpEntities}
                    onToggleEntity={(entityId) =>
                        setCollapsedMcpEntities((current) =>
                            toggleCollapsedEntityState(entityId, current),
                        )
                    }
                />
            </div>
        </div>
    );
}
