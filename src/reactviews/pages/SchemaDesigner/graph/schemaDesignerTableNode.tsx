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
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import * as FluentIcons from "@fluentui/react-icons";
import { NODEWIDTH } from "./schemaDesignerFlowConstants";
import { locConstants } from "../../../common/locConstants";
import { Edge, Handle, Node, Position, useReactFlow } from "@xyflow/react";
import { useContext } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";

const styles = makeStyles({
    columnsContainer: {},
});

export const SchemaDesignerTableNode = ({
    data,
}: {
    data: SchemaDesigner.Table;
}) => {
    const { getNodes, getEdges } = useReactFlow<
        Node<SchemaDesigner.Table>,
        Edge<SchemaDesigner.ForeignKey>
    >();

    const context = useContext(SchemaDesignerContext);

    const handleEditTable = () => {
        const nodes = getNodes();
        const edges = getEdges();

        // Find the node with the same id as the selected node
        const selectedNode = nodes.find((node) => node.data.id === data.id);
        const nodeEdges = edges.filter((edge) => edge.source === data.id);
        console.log("Selected node:", selectedNode);
        console.log("Node edges:", nodeEdges);
        // Create foreign from edges
        const foreignKeysMap = new Map<string, SchemaDesigner.ForeignKey>();
        nodeEdges.forEach((edge) => {
            const fk = edge.data;
            if (!fk) {
                return;
            }
            if (foreignKeysMap.has(fk.id)) {
                const existingFk = foreignKeysMap.get(fk.id);
                if (existingFk) {
                    existingFk.columns.push(...fk.columns);
                    existingFk.referencedColumns.push(...fk.referencedColumns);
                }
            } else {
                foreignKeysMap.set(fk.id, fk);
            }
        });

        const tableCopy = {
            ...data,
        };

        tableCopy.foreignKeys = Array.from(foreignKeysMap.values());

        console.log("Table copy:", tableCopy);
        context.setSelectedTable(tableCopy);
    };

    const classes = styles();
    return (
        <div
            style={{
                width: `${NODEWIDTH}px`,
                backgroundColor: "var(--vscode-editor-background)",
                borderRadius: "5px",
                display: "flex",
                flexDirection: "column",
                gap: "5px",
            }}
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    height: "50px",
                    flexDirection: "column",
                }}
            >
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        height: "30px",
                        flexDirection: "row",
                        alignItems: "center",
                        gap: "5px",
                        paddingTop: "10px",
                    }}
                >
                    <FluentIcons.TableRegular
                        style={{
                            padding: "0 5px",
                            width: "20px",
                            height: "20px",
                        }}
                    />
                    <Text
                        style={{
                            flexGrow: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            fontWeight: "600",
                        }}
                    >{`${data.schema}.${data.name}`}</Text>
                    <Button
                        appearance="subtle"
                        icon={<FluentIcons.EditRegular />}
                        disabled={false}
                        onClick={() => {
                            handleEditTable();
                        }}
                        style={{
                            marginLeft: "auto",
                        }}
                        size="small"
                    />
                    <Menu>
                        <MenuTrigger disableButtonEnhancement>
                            <MenuButton
                                icon={<FluentIcons.MoreVerticalRegular />}
                                style={{
                                    marginLeft: "auto",
                                }}
                                size="small"
                                appearance="subtle"
                            />
                        </MenuTrigger>

                        <MenuPopover>
                            <MenuList>
                                <MenuItem icon={<FluentIcons.FlowRegular />}>
                                    {
                                        locConstants.schemaDesigner
                                            .manageRelationships
                                    }
                                </MenuItem>
                                <MenuItem icon={<FluentIcons.DeleteRegular />}>
                                    {locConstants.schemaDesigner.delete}
                                </MenuItem>
                            </MenuList>
                        </MenuPopover>
                    </Menu>
                </div>
                <div
                    style={{
                        fontSize: "11px",
                        paddingLeft: "35px",
                    }}
                >
                    {locConstants.schemaDesigner.tableNodeSubText(
                        data.columns.length,
                    )}
                </div>
            </div>
            <Divider />
            <div className={classes.columnsContainer}>
                {data.columns.map((column) => {
                    return (
                        <div key={column.name} className={"column"}>
                            <Handle
                                type="source"
                                position={Position.Left}
                                id={`left-${column.name}`}
                                isConnectable={true}
                                style={{
                                    marginLeft: "2px",
                                }}
                            />
                            {column.isPrimaryKey && (
                                <FluentIcons.KeyRegular
                                    style={{
                                        padding: "0 5px",
                                        width: "16px",
                                        height: "16px",
                                    }}
                                />
                            )}
                            <Text
                                style={{
                                    flexGrow: 1,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    paddingLeft: column.isPrimaryKey
                                        ? "0px"
                                        : "30px",
                                }}
                            >
                                {column.name}
                            </Text>
                            <Text>{column.dataType.toUpperCase()}</Text>
                            <Handle
                                type="source"
                                position={Position.Right}
                                id={`right-${column.name}`}
                                isConnectable={true}
                                style={{
                                    marginRight: "2px",
                                }}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
