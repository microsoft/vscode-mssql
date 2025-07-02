/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    OverlayDrawer,
    TabValue,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { SchemaDesignerEditor } from "./schemaDesignerEditor";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { createContext, useContext, useEffect, useState } from "react";
import { locConstants } from "../../../common/locConstants";
import { columnUtils, foreignKeyUtils, tableUtils } from "../schemaDesignerUtils";
import { SchemaDesigner } from "../../../../shared/schemaDesigner";
import eventBus from "../schemaDesignerEvents";

export interface SchemaDesignerEditorContextProps {
    schema: SchemaDesigner.Schema;
    table: SchemaDesigner.Table;
    setTable: (table: SchemaDesigner.Table) => void;
    isEditDrawerOpen: boolean;
    setIsEditDrawerOpen: (open: boolean) => void;
    save(): void;
    cancel(): void;
    isNewTable: boolean;
    errors: Record<string, string>;
    warnings: Record<string, string>;
    schemas: string[];
    dataTypes: string[];
    selectedTabValue: TabValue;
    setSelectedTabValue: (tabValue: TabValue) => void;
}

export const SchemaDesignerEditorContext = createContext<SchemaDesignerEditorContextProps>(
    undefined as unknown as SchemaDesignerEditorContextProps,
);

export enum SchemaDesignerEditorTab {
    Table = "table",
    ForeignKeys = "foreignKeys",
}

export const TABLE_NAME_ERROR_KEY = `${SchemaDesignerEditorTab.Table}_name`;
export const FOREIGN_KEY_ERROR_PREFIX = `${SchemaDesignerEditorTab.ForeignKeys}_fk_`;

export const SchemaDesignerEditorDrawer = () => {
    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return undefined;
    }

    const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);

    const [schema, setSchema] = useState<SchemaDesigner.Schema>({
        tables: [],
    });

    const [table, setTable] = useState<SchemaDesigner.Table>({
        name: "",
        columns: [],
        schema: "",
        foreignKeys: [],
        id: "",
    });

    const [isNewTable, setIsNewTable] = useState(false);

    const [errors, setErrors] = useState<Record<string, string>>({});
    const [warnings, setWarnings] = useState<Record<string, string>>({});

    const [schemas, setSchemas] = useState<string[]>([]);
    const [dataTypes, setDataTypes] = useState<string[]>([]);

    const [selectedTabValue, setSelectedTabValue] = useState<TabValue>(
        SchemaDesignerEditorTab.Table,
    );

    useEffect(() => {
        setSchemas(context.schemaNames);
        setDataTypes(context.datatypes);
    }, [context]);

    useEffect(() => {
        const handleEditTable = (
            tableToEdit: SchemaDesigner.Table,
            schemaData: SchemaDesigner.Schema,
            showForeignKeySection?: boolean,
        ) => {
            // Get table with updated foreign keys
            const updatedTable = context.getTableWithForeignKeys(tableToEdit.id) || tableToEdit;

            // Update state
            setIsEditDrawerOpen(true);
            setSchema(schemaData);
            setTable(updatedTable);
            setIsNewTable(false);
            if (showForeignKeySection) {
                setSelectedTabValue(SchemaDesignerEditorTab.ForeignKeys);
            } else {
                setSelectedTabValue(SchemaDesignerEditorTab.Table);
            }
        };

        const handleNewTable = (schemaData: SchemaDesigner.Schema) => {
            setSchema(schemaData);
            setTable(tableUtils.createNewTable(schemaData, schemas));
            setIsNewTable(true);
            setIsEditDrawerOpen(true);
            setSelectedTabValue(SchemaDesignerEditorTab.Table);
        };
        eventBus.on("editTable", handleEditTable);
        eventBus.on("newTable", handleNewTable);

        return () => {
            eventBus.off("editTable", handleEditTable);
            eventBus.off("newTable", handleNewTable);
        };
    }, [schemas, dataTypes]);

    const saveTable = async () => {
        let success = false;

        if (isNewTable) {
            success = await context.addTable(table);
        } else {
            success = await context.updateTable(table);
        }

        if (success) {
            setIsEditDrawerOpen(false);
            eventBus.emit("getScript"); // Update the SQL script
            eventBus.emit("pushState"); // Update the history state
        }
    };

    useEffect(() => {
        const validateTable = () => {
            const errors: Record<string, string> = {};
            const warnings: Record<string, string> = {};
            const nameErrors = tableUtils.tableNameValidationError(schema, table);
            errors[TABLE_NAME_ERROR_KEY] = nameErrors ?? "";

            for (const column of table.columns) {
                const columnErrors = columnUtils.isColumnValid(column, table.columns);
                if (columnErrors) {
                    errors[`columns_${column.id}`] = columnErrors ?? "";
                }
            }

            // Validate foreign keys
            table.foreignKeys.forEach((fk) => {
                const foreignKeyErrors = foreignKeyUtils.isForeignKeyValid(
                    schema.tables,
                    table,
                    fk,
                );
                if (foreignKeyErrors) {
                    errors[`${FOREIGN_KEY_ERROR_PREFIX}${fk.id}`] =
                        foreignKeyErrors.errorMessage ?? "";
                }

                const foreignKeyWarnings = foreignKeyUtils.getForeignKeyWarnings(
                    schema.tables,
                    table,
                    fk,
                );

                if (foreignKeyWarnings) {
                    warnings[`${FOREIGN_KEY_ERROR_PREFIX}${fk.id}`] =
                        foreignKeyWarnings.errorMessage ?? "";
                }
            });
            setErrors(errors);
            setWarnings(warnings);
        };
        validateTable();
    }, [table]);

    return (
        <OverlayDrawer
            position={"end"}
            open={isEditDrawerOpen}
            onOpenChange={(_, { open }) => setIsEditDrawerOpen(open)}
            onKeyDown={(e) => {
                // Consuming backspace key to prevent graph from deleting selected nodes
                if (e.key === "Backspace") {
                    e.stopPropagation();
                }
            }}
            style={{ width: `600px` }}>
            <SchemaDesignerEditorContext.Provider
                value={{
                    schemas: schemas,
                    dataTypes: dataTypes,
                    schema: schema,
                    table: table,
                    setTable: setTable,
                    isEditDrawerOpen: isEditDrawerOpen,
                    setIsEditDrawerOpen: setIsEditDrawerOpen,
                    save: saveTable,
                    cancel: () => setIsEditDrawerOpen(false),
                    isNewTable: isNewTable,
                    errors: errors,
                    warnings: warnings,
                    selectedTabValue,
                    setSelectedTabValue,
                }}>
                <DrawerHeader>
                    <DrawerHeaderTitle
                        action={
                            <Button
                                appearance="subtle"
                                aria-label="Close"
                                icon={<FluentIcons.Dismiss24Regular />}
                                onClick={() => setIsEditDrawerOpen(false)}
                            />
                        }>
                        {isNewTable
                            ? locConstants.schemaDesigner.addTable
                            : locConstants.schemaDesigner.editTable}
                    </DrawerHeaderTitle>
                </DrawerHeader>

                <DrawerBody>
                    <SchemaDesignerEditor />
                </DrawerBody>
            </SchemaDesignerEditorContext.Provider>
        </OverlayDrawer>
    );
};
