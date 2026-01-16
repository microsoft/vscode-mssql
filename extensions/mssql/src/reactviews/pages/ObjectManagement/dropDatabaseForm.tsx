/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Checkbox, makeStyles } from "@fluentui/react-components";
import {
    DropDatabaseParams,
    DropDatabaseViewModel,
} from "../../../sharedInterfaces/objectManagement";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    sectionTitle: {
        fontSize: "14px",
        fontWeight: "600",
        color: "var(--vscode-foreground)",
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
        border: "1px solid var(--vscode-editorGroup-border)",
        backgroundColor: "var(--vscode-editor-background)",
    },
    tableHeaderCell: {
        textAlign: "left",
        fontSize: "12px",
        fontWeight: "600",
        padding: "8px 10px",
        color: "var(--vscode-foreground)",
        backgroundColor: "var(--vscode-editorWidget-background)",
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
    optionsSection: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
});

export interface DropDatabaseFormState extends DropDatabaseParams {}

export interface DropDatabaseFormProps {
    value: DropDatabaseFormState;
    viewModel: DropDatabaseViewModel;
    onChange: (next: DropDatabaseFormState) => void;
}

export const DropDatabaseForm = ({ value, viewModel, onChange }: DropDatabaseFormProps) => {
    const styles = useStyles();

    return (
        <>
            <div className={styles.sectionTitle}>{locConstants.dropDatabase.detailsSection}</div>
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
                            {viewModel.databaseName ?? locConstants.dropDatabase.valueUnknown}
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
            <div className={styles.optionsSection}>
                <div className={styles.sectionTitle}>
                    {locConstants.dropDatabase.optionsSection}
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
        </>
    );
};
