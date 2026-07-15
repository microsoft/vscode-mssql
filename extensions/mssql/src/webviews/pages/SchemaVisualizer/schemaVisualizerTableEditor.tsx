/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Table editor drawer (SV-R8c) — legacy-designer-style OverlayDrawer for
 * add/edit table. Edits a DRAFT; Save diffs the draft into semantic ops
 * (schemaVisualizerTableDraft.ts — identity-based, renames stay renames)
 * and hands them to the page's op log. The drawer never talks RPC.
 */

import { useMemo, useState } from "react";
import {
    Button,
    Checkbox,
    Dropdown,
    Field,
    Input,
    MessageBar,
    MessageBarBody,
    Option,
    OverlayDrawer,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    makeStyles,
    Text,
    tokens,
} from "@fluentui/react-components";
import { AddRegular, DeleteRegular, DismissRegular } from "@fluentui/react-icons";
import {
    SchemaVisualizerEditOp,
    TableRef,
} from "../../../schemaVisualizer/model/schemaVisualizerEdit";
import { EditableTable } from "../../../schemaVisualizer/model/schemaVisualizerEditReducer";
import {
    TableDraft,
    TableDraftColumn,
    TYPE_PICKER_ENTRIES,
    buildTableDraft,
    buildTypeSpec,
    diffTableDraft,
    newTableDraftToOps,
} from "../../../schemaVisualizer/model/schemaVisualizerTableDraft";

const useStyles = makeStyles({
    body: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        paddingBottom: "16px",
    },
    columnRow: {
        display: "flex",
        alignItems: "flex-end",
        gap: "6px",
    },
    columnName: {
        flex: 2,
        minWidth: 0,
    },
    columnType: {
        flex: 2,
        minWidth: 0,
    },
    columnLength: {
        width: "76px",
    },
    footer: {
        display: "flex",
        gap: "8px",
        paddingTop: "8px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
});

export interface TableEditorMode {
    kind: "edit" | "new";
    /** Present for kind "edit": the CURRENT editable table. */
    table?: EditableTable;
    /** Present for kind "new": pre-minted local ids. */
    localId?: string;
    defaultSchema?: string;
}

export interface SchemaVisualizerTableEditorProps {
    mode: TableEditorMode;
    newId: () => string;
    onSave: (ops: SchemaVisualizerEditOp[]) => void;
    onClose: () => void;
}

interface DraftColumnState extends TableDraftColumn {
    /** Picker state for rows whose type is being changed. */
    pickerType?: string;
    pickerLength?: string;
    pickerPrecision?: string;
    pickerScale?: string;
}

function initialDraft(mode: TableEditorMode, newId: () => string): TableDraft {
    if (mode.kind === "edit" && mode.table !== undefined) {
        return buildTableDraft(mode.table);
    }
    return {
        table: { kind: "new", localId: mode.localId ?? newId() },
        schema: mode.defaultSchema ?? "dbo",
        name: "NewTable",
        columns: [
            {
                ref: { kind: "new", localId: newId() },
                name: "Id",
                typeDisplay: "int",
                editedType: buildTypeSpec("int"),
                nullable: false,
            },
        ],
    };
}

function typeSpecFromPicker(column: DraftColumnState) {
    const typeName = column.pickerType;
    if (typeName === undefined) {
        return column.editedType;
    }
    const entry = TYPE_PICKER_ENTRIES.find((candidate) => candidate.typeName === typeName);
    if (entry === undefined) {
        return column.editedType;
    }
    if (entry.lengthKind === "length" || entry.lengthKind === "lengthOrMax") {
        const raw = (column.pickerLength ?? "").trim().toLowerCase();
        const length =
            raw === "max" && entry.lengthKind === "lengthOrMax"
                ? ("max" as const)
                : raw.length > 0 && Number.isInteger(Number(raw)) && Number(raw) > 0
                  ? Number(raw)
                  : undefined;
        return buildTypeSpec(typeName, length !== undefined ? { length } : { length: 50 });
    }
    if (entry.lengthKind === "precisionScale") {
        const precision = Number((column.pickerPrecision ?? "").trim());
        const scale = Number((column.pickerScale ?? "").trim());
        return buildTypeSpec(typeName, {
            precision: Number.isInteger(precision) && precision > 0 ? precision : 18,
            scale: Number.isInteger(scale) && scale >= 0 ? scale : 0,
        });
    }
    return buildTypeSpec(typeName);
}

export const SchemaVisualizerTableEditor = (props: SchemaVisualizerTableEditorProps) => {
    const styles = useStyles();
    const { mode, newId } = props;
    const base = useMemo(() => initialDraft(mode, newId), [mode, newId]);
    const [name, setName] = useState(base.name);
    const [schema, setSchema] = useState(base.schema);
    const [columns, setColumns] = useState<DraftColumnState[]>(base.columns);
    const [errors, setErrors] = useState<string[]>([]);

    const save = () => {
        const draft: TableDraft = {
            table: base.table as TableRef,
            schema,
            name,
            columns: columns.map((column) => ({
                ref: column.ref,
                name: column.name,
                typeDisplay: column.typeDisplay,
                nullable: column.nullable,
                ...(typeSpecFromPicker(column) !== undefined
                    ? { editedType: typeSpecFromPicker(column) }
                    : {}),
            })),
        };
        const result =
            mode.kind === "new"
                ? newTableDraftToOps(draft, newId)
                : diffTableDraft(mode.table!, draft, newId);
        if (result.errors.length > 0) {
            setErrors(result.errors);
            return;
        }
        props.onSave(result.ops);
    };

    const updateColumn = (index: number, patch: Partial<DraftColumnState>) => {
        setColumns((current) =>
            current.map((column, i) => (i === index ? { ...column, ...patch } : column)),
        );
    };

    return (
        <OverlayDrawer open position="end" size="medium" onOpenChange={() => props.onClose()}>
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label="Close"
                            icon={<DismissRegular />}
                            onClick={props.onClose}
                        />
                    }>
                    {mode.kind === "new" ? "Add Table" : `Edit ${schema}.${name}`}
                </DrawerHeaderTitle>
            </DrawerHeader>
            <DrawerBody className={styles.body}>
                {errors.length > 0 && (
                    <MessageBar intent="error">
                        <MessageBarBody>{errors.join(" ")}</MessageBarBody>
                    </MessageBar>
                )}
                <Field label="Schema">
                    <Input value={schema} onChange={(_e, data) => setSchema(data.value)} />
                </Field>
                <Field label="Name">
                    <Input value={name} onChange={(_e, data) => setName(data.value)} />
                </Field>
                <Text weight="semibold">Columns</Text>
                {columns.map((column, index) => {
                    const picking =
                        column.pickerType !== undefined
                            ? TYPE_PICKER_ENTRIES.find(
                                  (entry) => entry.typeName === column.pickerType,
                              )
                            : undefined;
                    return (
                        <div
                            key={
                                column.ref.kind === "existing"
                                    ? `c${column.ref.columnId}`
                                    : column.ref.localId
                            }
                            className={styles.columnRow}>
                            <Field
                                label={index === 0 ? "Name" : undefined}
                                className={styles.columnName}>
                                <Input
                                    value={column.name}
                                    onChange={(_e, data) =>
                                        updateColumn(index, { name: data.value })
                                    }
                                />
                            </Field>
                            <Field
                                label={index === 0 ? "Type" : undefined}
                                className={styles.columnType}>
                                <Dropdown
                                    value={column.pickerType ?? column.typeDisplay}
                                    selectedOptions={
                                        column.pickerType !== undefined ? [column.pickerType] : []
                                    }
                                    onOptionSelect={(_e, data) =>
                                        updateColumn(index, {
                                            pickerType: data.optionValue,
                                        })
                                    }>
                                    {TYPE_PICKER_ENTRIES.map((entry) => (
                                        <Option key={entry.typeName} value={entry.typeName}>
                                            {entry.typeName}
                                        </Option>
                                    ))}
                                </Dropdown>
                            </Field>
                            {picking !== undefined &&
                                (picking.lengthKind === "length" ||
                                    picking.lengthKind === "lengthOrMax") && (
                                    <Field
                                        label={index === 0 ? "Length" : undefined}
                                        className={styles.columnLength}>
                                        <Input
                                            placeholder={
                                                picking.lengthKind === "lengthOrMax"
                                                    ? "50|max"
                                                    : "50"
                                            }
                                            value={column.pickerLength ?? ""}
                                            onChange={(_e, data) =>
                                                updateColumn(index, { pickerLength: data.value })
                                            }
                                        />
                                    </Field>
                                )}
                            {picking !== undefined && picking.lengthKind === "precisionScale" && (
                                <>
                                    <Field
                                        label={index === 0 ? "P" : undefined}
                                        className={styles.columnLength}>
                                        <Input
                                            placeholder="18"
                                            value={column.pickerPrecision ?? ""}
                                            onChange={(_e, data) =>
                                                updateColumn(index, {
                                                    pickerPrecision: data.value,
                                                })
                                            }
                                        />
                                    </Field>
                                    <Field
                                        label={index === 0 ? "S" : undefined}
                                        className={styles.columnLength}>
                                        <Input
                                            placeholder="0"
                                            value={column.pickerScale ?? ""}
                                            onChange={(_e, data) =>
                                                updateColumn(index, { pickerScale: data.value })
                                            }
                                        />
                                    </Field>
                                </>
                            )}
                            <Checkbox
                                label={index === 0 ? "Nullable" : undefined}
                                checked={column.nullable}
                                onChange={(_e, data) =>
                                    updateColumn(index, { nullable: data.checked === true })
                                }
                            />
                            <Button
                                appearance="subtle"
                                aria-label={`Remove column ${column.name}`}
                                icon={<DeleteRegular />}
                                onClick={() =>
                                    setColumns((current) => current.filter((_c, i) => i !== index))
                                }
                            />
                        </div>
                    );
                })}
                <div>
                    <Button
                        icon={<AddRegular />}
                        onClick={() =>
                            setColumns((current) => [
                                ...current,
                                {
                                    ref: { kind: "new", localId: newId() },
                                    name: `Column${current.length + 1}`,
                                    typeDisplay: "int",
                                    editedType: buildTypeSpec("int"),
                                    nullable: true,
                                },
                            ])
                        }>
                        Add column
                    </Button>
                </div>
                <div className={styles.footer}>
                    <Button appearance="primary" onClick={save}>
                        Save
                    </Button>
                    <Button onClick={props.onClose}>Cancel</Button>
                </div>
            </DrawerBody>
        </OverlayDrawer>
    );
};
