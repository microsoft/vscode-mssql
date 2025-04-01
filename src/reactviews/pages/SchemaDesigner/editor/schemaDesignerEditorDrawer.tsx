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
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { SchemaDesignerEditor } from "./schemaDesignerEditor";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { createContext, useContext, useEffect, useState } from "react";
import { locConstants } from "../../../common/locConstants";
import { foreignKeyUtils, tableUtils } from "../schemaDesignerUtils";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
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
    setErrors: (errors: Record<string, string>) => void;
    schemas: string[];
    dataTypes: string[];
    showForeignKey: boolean;
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

    const [schemas, setSchemas] = useState<string[]>([]);
    const [dataTypes, setDataTypes] = useState<string[]>([]);

    const [showForeignKey, setShowForeignKey] = useState(false);

    useEffect(() => {
        const handleEditTable = (
            tableToEdit: SchemaDesigner.Table,
            schemaData: SchemaDesigner.Schema,
            showForeignKeySection?: boolean,
        ) => {
            // Get table with updated foreign keys
            const updatedTable = context.getTableWithForeignKeys(tableToEdit.id) || tableToEdit;

            // Update state
            setSchemas(context.schemaNames);
            setDataTypes(context.datatypes);
            setIsEditDrawerOpen(true);
            setSchema(schemaData);
            setTable(updatedTable);
            setIsNewTable(false);
            setShowForeignKey(Boolean(showForeignKeySection));
        };

        const handleNewTable = (schemaData: SchemaDesigner.Schema) => {
            setSchemas(context.schemaNames);
            setDataTypes(context.datatypes);
            setSchema(schemaData);
            setTable(tableUtils.createNewTable(schemaData, context.schemaNames));
            setIsNewTable(true);
            setIsEditDrawerOpen(true);
        };
        eventBus.on("editTable", handleEditTable);
        eventBus.on("newTable", handleNewTable);

        return () => {
            eventBus.off("editTable", handleEditTable);
            eventBus.off("newTable", handleNewTable);
        };
    }, []);

    const saveTable = async () => {
        // If errors are present, do not save
        if (Object.keys(errors).length > 0) {
            return;
        }

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
            const nameErrors = tableUtils.tableNameValidationError(schema, table);
            errors[TABLE_NAME_ERROR_KEY] = nameErrors ?? "";

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
            });
            setErrors(errors);
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
                    setErrors: setErrors,
                    showForeignKey: showForeignKey,
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
