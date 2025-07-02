/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Divider,
    makeStyles,
    Menu,
    MenuButton,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Text,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { useContext } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { SchemaDesigner } from "../../../../shared/schemaDesigner";
import eventBus from "../schemaDesignerEvents";
import { LAYOUT_CONSTANTS } from "../schemaDesignerUtils";

// Styles for the table node components
const useStyles = makeStyles({
    tableNodeContainer: {
        width: `${LAYOUT_CONSTANTS.NODE_WIDTH}px`,
        backgroundColor: "var(--vscode-editor-background)",
        borderRadius: "5px",
        display: "flex",
        flexDirection: "column",
        gap: "5px",
    },
    tableHeader: {
        width: "100%",
        display: "flex",
        height: "50px",
        flexDirection: "column",
    },
    tableHeaderRow: {
        width: "100%",
        display: "flex",
        height: "30px",
        flexDirection: "row",
        alignItems: "center",
        gap: "5px",
        paddingTop: "10px",
    },
    tableIcon: {
        padding: "0 5px",
        width: "20px",
        height: "20px",
    },
    tableTitle: {
        flexGrow: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontWeight: "600",
    },
    tableSubtitle: {
        fontSize: "11px",
        paddingLeft: "35px",
    },
    columnName: {
        flexGrow: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    columnType: {
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
    },
    handleLeft: {
        marginLeft: "2px",
    },
    handleRight: {
        marginRight: "2px",
    },
    keyIcon: {
        padding: "0 5px",
        width: "16px",
        height: "16px",
    },
    actionButton: {
        marginLeft: "auto",
    },
});

// TableHeaderActions component for the edit button and menu
const TableHeaderActions = ({ table }: { table: SchemaDesigner.Table }) => {
    const context = useContext(SchemaDesignerContext);
    const styles = useStyles();

    const handleEditTable = () => {
        const schema = context.extractSchema();
        const foundTable = schema.tables.find((t) => t.id === table.id);

        if (!foundTable) {
            return;
        }

        const tableCopy = { ...table };
        eventBus.emit("editTable", tableCopy, schema);
    };

    const handleDeleteTable = () => {
        void context.deleteTable(table);
    };

    const handleManageRelationships = () => {
        const schema = context.extractSchema();
        const foundTable = schema.tables.find((t) => t.id === table.id);

        if (!foundTable) {
            return;
        }

        const tableCopy = { ...table };
        eventBus.emit("editTable", tableCopy, schema, true);
    };

    return (
        <>
            <Button
                appearance="subtle"
                icon={<FluentIcons.EditRegular />}
                onClick={handleEditTable}
                className={styles.actionButton}
                size="small"
            />
            <Menu>
                <MenuTrigger disableButtonEnhancement>
                    <MenuButton
                        icon={<FluentIcons.MoreVerticalRegular />}
                        className={styles.actionButton}
                        size="small"
                        appearance="subtle"
                    />
                </MenuTrigger>

                <MenuPopover>
                    <MenuList>
                        <MenuItem
                            icon={<FluentIcons.FlowRegular />}
                            onClick={handleManageRelationships}>
                            {locConstants.schemaDesigner.manageRelationships}
                        </MenuItem>
                        <MenuItem icon={<FluentIcons.DeleteRegular />} onClick={handleDeleteTable}>
                            {locConstants.schemaDesigner.delete}
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </>
    );
};

// TableHeader component for the table title and subtitle
const TableHeader = ({ table }: { table: SchemaDesigner.Table }) => {
    const styles = useStyles();
    const context = useContext(SchemaDesignerContext);

    // Function to highlight text based on search
    const highlightText = (text: string) => {
        if (!context.findTableText || context.findTableText.trim() === "") {
            return <span>{text}</span>;
        }

        // Case insensitive search
        const regex = new RegExp(
            `(${context.findTableText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
            "gi",
        );
        const parts = text.split(regex);

        return (
            <>
                {parts.map((part, index) => {
                    // Check if this part matches the search text (case insensitive)
                    const isMatch = part.toLowerCase() === context.findTableText.toLowerCase();
                    return isMatch ? (
                        <span
                            key={index}
                            style={{
                                backgroundColor: "var(--vscode-editor-findMatchBackground)",
                                color: "var(--vscode-editor-background)",
                                padding: "0 2px",
                                borderRadius: "3px",
                            }}>
                            {part}
                        </span>
                    ) : (
                        <span key={index}>{part}</span>
                    );
                })}
            </>
        );
    };
    return (
        <div className={styles.tableHeader}>
            <div className={styles.tableHeaderRow}>
                <FluentIcons.TableRegular className={styles.tableIcon} />
                <Text className={styles.tableTitle}>
                    {highlightText(`${table.schema}.${table.name}`)}
                </Text>
                <TableHeaderActions table={table} />
            </div>
            <div className={styles.tableSubtitle}>
                {locConstants.schemaDesigner.tableNodeSubText(table.columns.length)}
            </div>
        </div>
    );
};

// TableColumn component for rendering a single column
const TableColumn = ({ column }: { column: SchemaDesigner.Column }) => {
    const styles = useStyles();
    return (
        <div className={"column"} key={column.name}>
            <Handle
                type="source"
                position={Position.Left}
                id={`left-${column.name}`}
                isConnectable={true}
                className={styles.handleLeft}
            />

            {column.isPrimaryKey && <FluentIcons.KeyRegular className={styles.keyIcon} />}

            <Text
                className={styles.columnName}
                style={{ paddingLeft: column.isPrimaryKey ? "0px" : "30px" }}>
                {column.name}
            </Text>

            <Text className={styles.columnType}>
                {column.isComputed ? "COMPUTED" : column.dataType?.toUpperCase()}
            </Text>

            <Handle
                type="source"
                position={Position.Right}
                id={`right-${column.name}`}
                isConnectable={true}
                className={styles.handleRight}
            />
        </div>
    );
};

// TableColumns component for rendering all columns
const TableColumns = ({ columns }: { columns: SchemaDesigner.Column[] }) => {
    return (
        <div>
            {columns.map((column, index) => (
                <TableColumn key={`${index}-${column.name}`} column={column} />
            ))}
        </div>
    );
};

// Main SchemaDesignerTableNode component
export const SchemaDesignerTableNode = (props: NodeProps) => {
    const styles = useStyles();

    return (
        <div className={styles.tableNodeContainer}>
            <TableHeader table={props.data as SchemaDesigner.Table} />
            <Divider />
            <TableColumns columns={(props.data as SchemaDesigner.Table).columns} />
        </div>
    );
};
