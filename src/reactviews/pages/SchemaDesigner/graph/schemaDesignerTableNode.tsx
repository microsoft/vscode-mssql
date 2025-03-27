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
import { Handle, Position, useReactFlow } from "@xyflow/react";
import { useContext } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import eventBus, { NODE_WIDTH } from "../schemaDesignerUtils";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

// Styles for the table node components
const useStyles = makeStyles({
    tableNodeContainer: {
        width: `${NODE_WIDTH}px`,
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
    columnRow: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        padding: "4px 10px",
        position: "relative",
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
    const reactFlow = useReactFlow();
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

    const handleManageRelationships = () => {
        const schema = context.extractSchema();
        const foundTable = schema.tables.find((t) => t.id === table.id);

        if (!foundTable) {
            return;
        }

        const tableCopy = { ...table };
        eventBus.emit("editTable", tableCopy, schema, true);
    };

    const handleDeleteTable = () => {
        const node = reactFlow.getNode(table.id);
        if (!node) {
            return;
        }
        void reactFlow.deleteElements({ nodes: [node] });
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
                            onClick={handleManageRelationships}
                        >
                            {locConstants.schemaDesigner.manageRelationships}
                        </MenuItem>
                        <MenuItem
                            icon={<FluentIcons.DeleteRegular />}
                            onClick={handleDeleteTable}
                        >
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

    return (
        <div className={styles.tableHeader}>
            <div className={styles.tableHeaderRow}>
                <FluentIcons.TableRegular className={styles.tableIcon} />
                <Text className={styles.tableTitle}>
                    {`${table.schema}.${table.name}`}
                </Text>
                <TableHeaderActions table={table} />
            </div>
            <div className={styles.tableSubtitle}>
                {locConstants.schemaDesigner.tableNodeSubText(
                    table.columns.length,
                )}
            </div>
        </div>
    );
};

// TableColumn component for rendering a single column
const TableColumn = ({ column }: { column: SchemaDesigner.Column }) => {
    const styles = useStyles();

    return (
        <div className={styles.columnRow} key={column.name}>
            <Handle
                type="source"
                position={Position.Left}
                id={`left-${column.name}`}
                isConnectable={true}
                className={styles.handleLeft}
            />

            {column.isPrimaryKey && (
                <FluentIcons.KeyRegular className={styles.keyIcon} />
            )}

            <Text
                className={styles.columnName}
                style={{ paddingLeft: column.isPrimaryKey ? "0px" : "30px" }}
            >
                {column.name}
            </Text>

            <Text className={styles.columnType}>
                {column.dataType.toUpperCase()}
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
            {columns.map((column) => (
                <TableColumn key={column.name} column={column} />
            ))}
        </div>
    );
};

// Main SchemaDesignerTableNode component
export const SchemaDesignerTableNode = ({
    data,
}: {
    data: SchemaDesigner.Table;
}) => {
    const styles = useStyles();

    return (
        <div className={styles.tableNodeContainer}>
            <TableHeader table={data} />
            <Divider />
            <TableColumns columns={data.columns} />
        </div>
    );
};
