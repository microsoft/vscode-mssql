/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Checkbox, makeStyles, tokens } from "@fluentui/react-components";
import {
    DropDatabaseParams,
    DropDatabaseViewModel,
} from "../../../sharedInterfaces/objectManagement";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        width: "100%",
        maxWidth: "560px",
        display: "flex",
        flexDirection: "column",
        gap: "22px",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "14px",
    },
    sectionHeader: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        paddingBottom: "10px",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
    },
    sectionTitle: {
        fontSize: tokens.fontSizeBase300,
        lineHeight: tokens.lineHeightBase300,
        fontWeight: tokens.fontWeightSemibold,
        color: "var(--vscode-foreground)",
    },
    tableContainer: {
        overflow: "hidden",
        borderRadius: "8px",
        border: "1px solid var(--vscode-editorGroup-border)",
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
    },
    tableHeaderCell: {
        textAlign: "left",
        fontSize: "12px",
        fontWeight: "600",
        padding: "8px 10px",
        color: "var(--vscode-foreground)",
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-sideBar-background))",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
    },
    tableCell: {
        fontSize: "13px",
        padding: "8px 10px",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
        color: "var(--vscode-foreground)",
    },
    fieldGroup: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    confirmationBox: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "16px 18px",
        borderRadius: "8px",
        border: "1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground))",
        backgroundColor:
            "color-mix(in srgb, var(--vscode-inputValidation-errorBackground, var(--vscode-editor-background)) 70%, transparent)",
    },
    confirmationText: {
        color: "var(--vscode-errorForeground)",
        fontWeight: tokens.fontWeightSemibold,
    },
});

export interface DropDatabaseFormState extends DropDatabaseParams {}

export interface DropDatabaseFormProps {
    value: DropDatabaseFormState;
    viewModel: DropDatabaseViewModel;
    isConfirmed: boolean;
    onChange: (next: DropDatabaseFormState) => void;
    onConfirmationChange: (confirmed: boolean) => void;
}

export const DropDatabaseForm = ({
    value,
    viewModel,
    isConfirmed,
    onChange,
    onConfirmationChange,
}: DropDatabaseFormProps) => {
    const styles = useStyles();

    return (
        <div className={styles.root}>
            <div className={styles.section}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionTitle}>
                        {locConstants.dropDatabase.detailsSection}
                    </div>
                </div>
                <div className={styles.tableContainer}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th className={styles.tableHeaderCell}>
                                    {locConstants.dropDatabase.nameColumn}
                                </th>
                                <th className={styles.tableHeaderCell}>
                                    {locConstants.dropDatabase.ownerColumn}
                                </th>
                                <th className={styles.tableHeaderCell}>
                                    {locConstants.dropDatabase.statusColumn}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className={styles.tableCell}>
                                    {viewModel.databaseName ??
                                        locConstants.dropDatabase.valueUnknown}
                                </td>
                                <td className={styles.tableCell}>
                                    {viewModel.owner ?? locConstants.dropDatabase.valueUnknown}
                                </td>
                                <td className={styles.tableCell}>
                                    {viewModel.status ?? locConstants.dropDatabase.valueUnknown}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            <div className={styles.section}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionTitle}>
                        {locConstants.dropDatabase.optionsSection}
                    </div>
                </div>
                <div className={styles.fieldGroup}>
                    <Checkbox
                        label={locConstants.dropDatabase.dropConnections}
                        checked={value.dropConnections}
                        onChange={(_, data) =>
                            onChange({
                                ...value,
                                dropConnections: !!data.checked,
                            })
                        }
                    />
                    <Checkbox
                        label={locConstants.dropDatabase.deleteBackupHistory}
                        checked={value.deleteBackupHistory}
                        onChange={(_, data) =>
                            onChange({
                                ...value,
                                deleteBackupHistory: !!data.checked,
                            })
                        }
                    />
                </div>
            </div>
            <div className={styles.confirmationBox}>
                <Checkbox
                    checked={isConfirmed}
                    onChange={(_, data) => onConfirmationChange(!!data.checked)}
                    label={
                        <span className={styles.confirmationText}>
                            {locConstants.dropDatabase.confirmationLabel}
                        </span>
                    }
                />
            </div>
        </div>
    );
};
