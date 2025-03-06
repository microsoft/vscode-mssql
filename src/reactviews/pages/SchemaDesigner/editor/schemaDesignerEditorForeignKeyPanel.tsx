/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Card,
    CardHeader,
    Dropdown,
    Field,
    Input,
    Label,
    makeStyles,
    Option,
    Text,
} from "@fluentui/react-components";
import { AddRegular, DeleteRegular } from "@fluentui/react-icons";
import { v4 as uuidv4 } from "uuid";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    getAllTables,
    getNextForeignKeyName,
    getTableFromDisplayName,
} from "../schemaDesignerUtils";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { locConstants } from "../../../common/locConstants";

const useStyles = makeStyles({
    tablePanel: {
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        overflowX: "hidden",
        padding: "10px",
        gap: "10px",
    },
    tablePanelRow: {
        display: "flex",
        flexDirection: "row",
        flex: "1",
        gap: "5px",
        padding: "0px 5px",
    },
});

export const SchemaDesignerEditorForeignKeyPanel = () => {
    const classes = useStyles();
    const context = useContext(SchemaDesignerContext);
    const allTables = useMemo(
        () => getAllTables(context.schema, context.selectedTable),
        [context.selectedTable],
    );
    const foreignKeyNameInputRefs = useRef<Array<HTMLInputElement | null>>([]);
    const [lastForeignKeyNameInputIndex, setLastForeignKeyNameInputIndex] =
        useState<number>(-1);

    useEffect(() => {
        if (context.selectedTable) {
            setLastForeignKeyNameInputIndex(-1);
        }
    }, [context.selectedTable]);

    useEffect(() => {
        if (lastForeignKeyNameInputIndex >= 0) {
            foreignKeyNameInputRefs.current[
                lastForeignKeyNameInputIndex
            ]?.focus();
        }
    }, [lastForeignKeyNameInputIndex]);

    return (
        <div className={classes.tablePanel}>
            <Button
                icon={<AddRegular />}
                style={{
                    width: "200px",
                }}
                onClick={() => {
                    const firstTable = allTables[0];
                    const newForeignKey: SchemaDesigner.ForeignKey = {
                        id: uuidv4(),
                        name: getNextForeignKeyName(
                            context.selectedTable.foreignKeys,
                        ),
                        columns: [context.selectedTable.columns[0].name],
                        referencedSchemaName: firstTable.schema,
                        referencedTableName: firstTable.name,
                        referencedColumns: [firstTable.columns[0].name],
                        onDeleteAction: SchemaDesigner.OnAction.CASCADE,
                        onUpdateAction: SchemaDesigner.OnAction.CASCADE,
                    };
                    const newForeignKeys = [
                        ...context.selectedTable.foreignKeys,
                        newForeignKey,
                    ];
                    context.setSelectedTable({
                        ...context.selectedTable,
                        foreignKeys: newForeignKeys,
                    });
                    setLastForeignKeyNameInputIndex(newForeignKeys.length - 1);
                }}
            >
                {locConstants.schemaDesigner.newForeignKey}
            </Button>
            <div
                style={{
                    flex: "1",
                    overflow: "auto",
                    padding: "5px",
                }}
            >
                {context.selectedTable.foreignKeys.map((fk, index) => {
                    return (
                        <Card
                            style={{
                                marginBottom: "10px",
                                borderColor: "var(--vscode-badge-background)",
                            }}
                            key={`${fk.name}-${index}`}
                        >
                            <CardHeader
                                header={
                                    <Text>
                                        {locConstants.schemaDesigner.foreignKeyIndex(
                                            index + 1,
                                        )}
                                    </Text>
                                }
                                action={
                                    <Button
                                        appearance="subtle"
                                        icon={<DeleteRegular />}
                                        onClick={() => {
                                            const newForeignKeys = [
                                                ...context.selectedTable
                                                    .foreignKeys,
                                            ];
                                            newForeignKeys.splice(index, 1);
                                            context.setSelectedTable({
                                                ...context.selectedTable,
                                                foreignKeys: newForeignKeys,
                                            });
                                        }}
                                    ></Button>
                                }
                            ></CardHeader>
                            <div className={classes.tablePanelRow}>
                                <Field style={{ flex: 1 }} size="small">
                                    <Label>
                                        {locConstants.schemaDesigner.name}
                                    </Label>
                                    <Input
                                        size="small"
                                        value={
                                            context.selectedTable.foreignKeys[
                                                index
                                            ].name
                                        }
                                        ref={(ref) => {
                                            foreignKeyNameInputRefs.current[
                                                index
                                            ] = ref;
                                        }}
                                        onChange={(_e, d) => {
                                            const newEdges = [
                                                ...context.selectedTable
                                                    .foreignKeys,
                                            ];
                                            newEdges[index].name = d.value;
                                            context.setSelectedTable({
                                                ...context.selectedTable,
                                                foreignKeys: newEdges,
                                            });
                                        }}
                                    />
                                </Field>
                            </div>
                            <div className={classes.tablePanelRow}>
                                <Field style={{ flex: 1 }} size="small">
                                    <Label>
                                        {
                                            locConstants.schemaDesigner
                                                .targetTable
                                        }
                                    </Label>
                                    <Dropdown
                                        size="small"
                                        value={`${fk.referencedSchemaName}.${fk.referencedTableName}`}
                                        selectedOptions={[
                                            `${fk.referencedSchemaName}.${fk.referencedTableName}`,
                                        ]}
                                        multiselect={false}
                                        onOptionSelect={(_e, data) => {
                                            if (!data.optionText) {
                                                return;
                                            }
                                            const newForeignKeys = [
                                                ...context.selectedTable
                                                    .foreignKeys,
                                            ];
                                            const entity =
                                                getTableFromDisplayName(
                                                    context.schema,
                                                    data.optionText,
                                                );
                                            newForeignKeys[
                                                index
                                            ].referencedTableName = entity.name;
                                            newForeignKeys[
                                                index
                                            ].referencedSchemaName =
                                                entity.schema;
                                            newForeignKeys[
                                                index
                                            ].referencedColumns = [
                                                entity.columns[0].name,
                                            ];
                                            context.setSelectedTable({
                                                ...context.selectedTable,
                                                foreignKeys: newForeignKeys,
                                            });
                                        }}
                                        style={{
                                            minWidth: "auto",
                                        }}
                                    >
                                        {allTables
                                            .slice()
                                            .sort((a, b) => {
                                                const displayNameA = `${a.schema}.${a.name}`;
                                                const displayNameB = `${b.schema}.${b.name}`;
                                                return displayNameA
                                                    .toLowerCase()
                                                    .localeCompare(
                                                        displayNameB.toLowerCase(),
                                                    );
                                            })
                                            .map((table) => {
                                                const displayName = `${table.schema}.${table.name}`;
                                                return (
                                                    <Option
                                                        key={table.name}
                                                        value={displayName}
                                                    >
                                                        {displayName}
                                                    </Option>
                                                );
                                            })}
                                    </Dropdown>
                                </Field>
                            </div>
                            <div className={classes.tablePanelRow}>
                                <Field style={{ flex: 1 }}>
                                    <Label>
                                        {
                                            locConstants.schemaDesigner
                                                .sourceColumn
                                        }
                                    </Label>
                                    <Dropdown
                                        size="small"
                                        value={fk.columns[0]}
                                        selectedOptions={[fk.columns[0]]}
                                        multiselect={false}
                                        onOptionSelect={(_e, data) => {
                                            if (!data.optionText) {
                                                return;
                                            }
                                            const newForeignKeys = [
                                                ...context.selectedTable
                                                    .foreignKeys,
                                            ];
                                            newForeignKeys[index].columns = [
                                                data.optionText,
                                            ];
                                            context.setSelectedTable({
                                                ...context.selectedTable,
                                                foreignKeys: newForeignKeys,
                                            });
                                        }}
                                        style={{
                                            minWidth: "auto",
                                        }}
                                    >
                                        {context.selectedTable.columns
                                            .slice()
                                            .sort((a, b) => {
                                                return a.name
                                                    .toLowerCase()
                                                    .localeCompare(
                                                        b.name.toLowerCase(),
                                                    );
                                            })
                                            .map((column) => (
                                                <Option
                                                    key={column.name}
                                                    value={column.name}
                                                >
                                                    {column.name}
                                                </Option>
                                            ))}
                                    </Dropdown>
                                </Field>
                                <Field style={{ flex: 1 }}>
                                    <Label>
                                        {
                                            locConstants.schemaDesigner
                                                .foreignColumn
                                        }
                                    </Label>
                                    <Dropdown
                                        size="small"
                                        value={fk.referencedColumns[0]}
                                        selectedOptions={[
                                            fk.referencedColumns[0],
                                        ]}
                                        multiselect={false}
                                        onOptionSelect={(_e, data) => {
                                            if (!data.optionText) {
                                                return;
                                            }
                                            const newForeignKeys = [
                                                ...context.selectedTable
                                                    .foreignKeys,
                                            ];
                                            newForeignKeys[
                                                index
                                            ].referencedColumns = [
                                                data.optionText,
                                            ];
                                            context.setSelectedTable({
                                                ...context.selectedTable,
                                                foreignKeys: newForeignKeys,
                                            });
                                        }}
                                        style={{
                                            minWidth: "auto",
                                        }}
                                    >
                                        {getTableFromDisplayName(
                                            context.schema,
                                            `${fk.referencedSchemaName}.${fk.referencedTableName}`,
                                        )
                                            .columns.slice()
                                            .sort((a, b) => {
                                                return a.name
                                                    .toLowerCase()
                                                    .localeCompare(
                                                        b.name.toLowerCase(),
                                                    );
                                            })
                                            .map((column) => (
                                                <Option
                                                    key={column.name}
                                                    value={column.name}
                                                >
                                                    {column.name}
                                                </Option>
                                            ))}
                                    </Dropdown>
                                </Field>
                            </div>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
};
