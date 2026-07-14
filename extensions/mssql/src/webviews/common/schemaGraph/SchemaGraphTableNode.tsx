/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Provider-neutral schema graph table node (SV-R3; addendum §10.2).
 * Presentational ONLY: renders SchemaGraphTableData from props — no page
 * context, no event bus, no diff/change providers, no Copilot, no RPC.
 * Visual language intentionally matches the legacy Schema Designer node
 * (300px card, VS Code theme variables, PK/FK icons, uppercased type,
 * collapse beyond 10 columns with consolidated hidden handles so edges to
 * hidden columns keep anchoring).
 */

import { useEffect, useState } from "react";
import {
    Button,
    Divider,
    makeStyles,
    mergeClasses,
    Text,
    Tooltip,
} from "@fluentui/react-components";
import { ChevronDownRegular, ChevronUpRegular, TableRegular } from "@fluentui/react-icons";
import { Handle, NodeProps, Position, useUpdateNodeInternals } from "@xyflow/react";
import { locConstants } from "../locConstants";
import { ForeignKeyIcon } from "../icons/foreignKey";
import { PrimaryKeyIcon } from "../icons/primaryKey";
import {
    SchemaGraphColumnData,
    SchemaGraphTableData,
    schemaGraphColumnAriaLabel,
    schemaGraphTableAriaLabel,
    splitColumnsForCollapse,
} from "./schemaGraphTypes";
import { SCHEMA_GRAPH_NODE_WIDTH } from "./schemaGraphDimensions";

const useStyles = makeStyles({
    container: {
        width: `${SCHEMA_GRAPH_NODE_WIDTH}px`,
        backgroundColor: "var(--vscode-editor-background)",
        borderRadius: "5px",
        display: "flex",
        flexDirection: "column",
        gap: "5px",
        position: "relative",
        overflow: "visible",
    },
    dimmedOverlay: {
        position: "absolute",
        inset: 0,
        backgroundColor: "var(--vscode-editor-background)",
        opacity: 0.4,
        pointerEvents: "none",
        zIndex: 10,
    },
    header: {
        width: "100%",
        display: "flex",
        minHeight: "50px",
        flexDirection: "column",
    },
    headerRow: {
        width: "100%",
        display: "flex",
        height: "30px",
        flexDirection: "row",
        alignItems: "center",
        gap: "5px",
        paddingTop: "10px",
        marginBottom: "4px",
    },
    tableIcon: {
        padding: "0 5px",
        width: "20px",
        height: "20px",
    },
    title: {
        flexGrow: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontWeight: "600",
        whiteSpace: "nowrap",
    },
    subtitle: {
        fontSize: "11px",
        paddingLeft: "35px",
    },
    columnRow: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: "30px",
        position: "relative",
    },
    columnName: {
        flexGrow: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    columnType: {
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
        paddingRight: "8px",
    },
    keyIcon: {
        padding: "0 5px",
        width: "16px",
        height: "16px",
    },
    handleLeft: {
        marginLeft: "2px",
    },
    handleRight: {
        marginRight: "2px",
    },
    collapseButton: {
        width: "100%",
    },
});

const ColumnRow = ({
    column,
    connectable,
}: {
    column: SchemaGraphColumnData;
    connectable: boolean;
}) => {
    const styles = useStyles();
    const hasKeyIcon = column.isPrimaryKey || column.isForeignKey;
    return (
        <div
            className={mergeClasses("column", styles.columnRow)}
            role="listitem"
            aria-label={schemaGraphColumnAriaLabel(column)}>
            <Handle
                type="source"
                position={Position.Left}
                id={`left-${column.id}`}
                isConnectable={connectable}
                className={styles.handleLeft}
            />
            {column.isPrimaryKey && <PrimaryKeyIcon className={styles.keyIcon} />}
            {!column.isPrimaryKey && column.isForeignKey && (
                <ForeignKeyIcon className={styles.keyIcon} />
            )}
            <Tooltip content={column.name} relationship="label">
                <Text
                    className={styles.columnName}
                    style={{ paddingLeft: hasKeyIcon ? "0px" : "30px" }}>
                    {column.name}
                </Text>
            </Tooltip>
            <Text className={styles.columnType}>
                {column.isComputed ? "COMPUTED" : column.typeDisplay.toUpperCase()}
            </Text>
            <Handle
                type="source"
                position={Position.Right}
                id={`right-${column.id}`}
                isConnectable={connectable}
                className={styles.handleRight}
            />
        </div>
    );
};

/** Invisible anchors for collapsed columns so their edges stay attached. */
const HiddenColumnHandles = ({
    columns,
    connectable,
}: {
    columns: SchemaGraphColumnData[];
    connectable: boolean;
}) => (
    <div
        style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "32px",
            pointerEvents: "none",
            zIndex: 1,
        }}>
        {columns.map((column) => (
            <div key={column.id}>
                <Handle
                    type="source"
                    position={Position.Left}
                    id={`left-${column.id}`}
                    isConnectable={connectable}
                    style={{
                        visibility: "hidden",
                        position: "absolute",
                        left: 0,
                        top: "50%",
                        transform: "translateY(-50%)",
                    }}
                />
                <Handle
                    type="source"
                    position={Position.Right}
                    id={`right-${column.id}`}
                    isConnectable={connectable}
                    style={{
                        visibility: "hidden",
                        position: "absolute",
                        right: 0,
                        top: "50%",
                        transform: "translateY(-50%)",
                    }}
                />
            </div>
        ))}
    </div>
);

export const SchemaGraphTableNode = (props: NodeProps) => {
    const styles = useStyles();
    const updateNodeInternals = useUpdateNodeInternals();
    const table = props.data as SchemaGraphTableData;
    const [collapsed, setCollapsed] = useState(true);
    const split = splitColumnsForCollapse(table.columns, collapsed);
    const connectable = false; // read-only surface; edits never originate here

    useEffect(() => {
        const rafId = requestAnimationFrame(() => {
            updateNodeInternals(table.id);
        });
        return () => {
            cancelAnimationFrame(rafId);
        };
    }, [table.id, table.columns, collapsed, updateNodeInternals]);

    return (
        <div
            className={styles.container}
            role="group"
            aria-label={schemaGraphTableAriaLabel(table)}>
            {table.dimmed === true && <div className={styles.dimmedOverlay} />}
            <div className={styles.header}>
                <div className={styles.headerRow}>
                    <TableRegular className={styles.tableIcon} />
                    <Tooltip content={`${table.schema}.${table.name}`} relationship="label">
                        <Text className={styles.title}>{`${table.schema}.${table.name}`}</Text>
                    </Tooltip>
                </div>
                <div className={styles.subtitle}>
                    {locConstants.schemaDesigner.tableNodeSubText(table.columns.length)}
                </div>
            </div>
            <Divider />
            <div style={{ position: "relative" }} role="list">
                {split.hidden.length > 0 && (
                    <HiddenColumnHandles columns={split.hidden} connectable={connectable} />
                )}
                {split.visible.map((column) => (
                    <ColumnRow key={column.id} column={column} connectable={connectable} />
                ))}
                {split.collapsible && (
                    <Button
                        className={styles.collapseButton}
                        onClick={() => setCollapsed(!collapsed)}
                        appearance="subtle"
                        icon={collapsed ? <ChevronDownRegular /> : <ChevronUpRegular />}
                        tabIndex={0}>
                        {collapsed ? (
                            <span>{locConstants.common.expand}</span>
                        ) : (
                            <span>{locConstants.common.collapse}</span>
                        )}
                    </Button>
                )}
            </div>
        </div>
    );
};
