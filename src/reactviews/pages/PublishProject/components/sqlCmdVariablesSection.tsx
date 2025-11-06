/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo, useCallback, useState, useEffect } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableCellLayout,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Input,
    Field,
    makeStyles,
    Button,
    Tooltip,
} from "@fluentui/react-components";
import { ArrowCounterclockwiseRegular } from "@fluentui/react-icons";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import { LocConstants } from "../../../common/locConstants";

const useStyles = makeStyles({
    tableContainer: {
        width: "100%",
        maxWidth: "640px",
        maxHeight: "425px",
        overflowY: "auto",
        border: "1px solid var(--vscode-panel-border)",
        position: "relative",
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
    },
    tableHeader: {
        position: "sticky",
        top: "0",
        backgroundColor: "var(--vscode-editor-background, var(--vscode-sideBar-background))",
        borderBottom: "2px solid var(--vscode-panel-border)",
        zIndex: 2,
    },
    tableHeaderCell: {
        borderRight: "1px solid var(--vscode-panel-border)",
        padding: "4px 8px",
        "&:last-child": {
            borderRight: "none",
        },
    },
    nameCell: {
        width: "40%",
        fontWeight: "600",
    },
    valueCell: {
        width: "60%",
    },
    tableCell: {
        borderRight: "1px solid var(--vscode-panel-border)",
        borderBottom: "1px solid var(--vscode-panel-border)",
        padding: "4px 8px",
        "&:last-child": {
            borderRight: "none",
        },
    },
    valueHeaderContent: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
    },
    revertButton: {
        minWidth: "20px",
        height: "20px",
        padding: "2px",
        marginLeft: "8px",
    },
});

export const SqlCmdVariablesSection: React.FC = () => {
    const styles = useStyles();
    const loc = LocConstants.getInstance().publishProject;
    const publishCtx = useContext(PublishProjectContext);
    const sqlCmdVariables = usePublishDialogSelector((s) => s.formState.sqlCmdVariables);
    const sqlCmdComponent = usePublishDialogSelector((s) => s.formComponents.sqlCmdVariables);
    const originalSqlCmdVariables = usePublishDialogSelector((s) => s.originalSqlCmdVariables);

    // Local state to track current input values (prevents cursor jumping)
    const [localValues, setLocalValues] = useState<{ [key: string]: string }>(
        sqlCmdVariables || {},
    );

    // Sync local values when sqlCmdVariables changes from external sources (e.g., profile load)
    useEffect(() => {
        setLocalValues(sqlCmdVariables || {});
    }, [sqlCmdVariables]);

    // Memoize variable entries calculation
    const variableEntries = useMemo(() => {
        return Object.entries(sqlCmdVariables || {});
    }, [sqlCmdVariables]);

    // Check if any values have been modified from their original values
    // Use localValues for immediate revert button update
    const hasModifiedValues = useMemo(() => {
        if (!originalSqlCmdVariables) {
            return false;
        }

        const allVarNames = new Set([
            ...Object.keys(localValues),
            ...Object.keys(originalSqlCmdVariables),
        ]);

        return Array.from(allVarNames).some((varName) => {
            const currentValue = localValues[varName] || "";
            const originalValue = originalSqlCmdVariables[varName] || "";
            return currentValue !== originalValue;
        });
    }, [localValues, originalSqlCmdVariables]);

    const handleValueChange = useCallback(
        (varName: string, newValue: string) => {
            if (!publishCtx || !sqlCmdComponent) return;

            setLocalValues((prev) => ({
                ...prev,
                [varName]: newValue,
            }));

            const updatedVariables = {
                ...sqlCmdVariables,
                [varName]: newValue,
            };
            publishCtx.formAction({
                propertyName: sqlCmdComponent.propertyName,
                isAction: false,
                value: updatedVariables as unknown as string | boolean,
                updateValidation: false,
            });
        },
        [sqlCmdVariables, sqlCmdComponent, publishCtx],
    );

    const handleValueBlur = useCallback(
        (varName: string, newValue: string) => {
            if (!publishCtx || !sqlCmdComponent) return;

            // Update backend state when user finishes editing
            const updatedVariables = {
                ...sqlCmdVariables,
                [varName]: newValue,
            };
            publishCtx.formAction({
                propertyName: sqlCmdComponent.propertyName,
                isAction: false,
                value: updatedVariables as unknown as string | boolean,
                updateValidation: true,
            });
        },
        [sqlCmdVariables, sqlCmdComponent, publishCtx],
    );

    const handleRevertValues = useCallback(() => {
        if (publishCtx && hasModifiedValues) {
            publishCtx.revertSqlCmdVariables();
        }
    }, [publishCtx, hasModifiedValues]);

    if (!publishCtx || !sqlCmdVariables || !sqlCmdComponent || sqlCmdComponent.hidden) {
        return undefined;
    }

    if (variableEntries.length === 0) {
        return undefined;
    }

    return (
        <Field
            label={sqlCmdComponent.label}
            required={sqlCmdComponent.required}
            orientation="horizontal">
            <div className={styles.tableContainer}>
                <Table className={styles.table} size="small" aria-label={loc.SqlCmdVariablesLabel}>
                    <TableHeader className={styles.tableHeader}>
                        <TableRow>
                            <TableHeaderCell
                                className={`${styles.tableHeaderCell} ${styles.nameCell}`}>
                                {loc.SqlCmdVariableNameColumn}
                            </TableHeaderCell>
                            <TableHeaderCell
                                className={`${styles.tableHeaderCell} ${styles.valueCell}`}>
                                <div className={styles.valueHeaderContent}>
                                    <span>{loc.SqlCmdVariableValueColumn}</span>
                                    <Tooltip
                                        content={loc.RevertSqlCmdVariablesToDefaults}
                                        relationship="label">
                                        <Button
                                            appearance="subtle"
                                            size="small"
                                            className={styles.revertButton}
                                            disabled={!hasModifiedValues}
                                            onClick={handleRevertValues}
                                            icon={<ArrowCounterclockwiseRegular />}
                                            aria-label={loc.RevertSqlCmdVariablesToDefaults}
                                        />
                                    </Tooltip>
                                </div>
                            </TableHeaderCell>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {variableEntries.map(([varName]) => (
                            <TableRow key={varName}>
                                <TableCell className={`${styles.tableCell} ${styles.nameCell}`}>
                                    <TableCellLayout>{varName}</TableCellLayout>
                                </TableCell>
                                <TableCell className={`${styles.tableCell} ${styles.valueCell}`}>
                                    <Input
                                        size="small"
                                        value={localValues[varName] || ""}
                                        onChange={(_, data) =>
                                            handleValueChange(varName, data.value)
                                        }
                                        onBlur={(e) =>
                                            handleValueBlur(varName, e.currentTarget.value)
                                        }
                                        aria-label={`Value for ${varName}`}
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </Field>
    );
};
