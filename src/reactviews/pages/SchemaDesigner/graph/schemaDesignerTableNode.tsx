/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Divider, makeStyles, Text } from "@fluentui/react-components";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import * as FluentIcons from "@fluentui/react-icons";
import { NODEWIDTH } from "./schemaDesignerFlowConstants";
import { locConstants } from "../../../common/locConstants";
import { Handle, Position } from "@xyflow/react";

const styles = makeStyles({
    columnsContainer: {},
});

export const SchemaDesignerTableNode = ({
    data,
}: {
    data: SchemaDesigner.Table;
}) => {
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
                            console.log("Edit table", data);
                        }}
                        style={{
                            marginLeft: "auto",
                        }}
                        size="small"
                    />
                    <Button
                        appearance="subtle"
                        icon={<FluentIcons.MoreVerticalRegular />}
                        disabled={false}
                        onClick={() => {
                            console.log("More options for table", data);
                        }}
                        style={{
                            marginLeft: "auto",
                        }}
                        size="small"
                    />
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
                                id={`column-in-${column.name}`}
                                isConnectable={true}
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
                                id={`column-out-${column.name}`}
                                isConnectable={true}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
