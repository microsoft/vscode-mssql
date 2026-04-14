/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Checkbox, Field, Input, makeStyles, tokens } from "@fluentui/react-components";
import {
    RenameDatabaseParams,
    RenameDatabaseViewModel,
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
});

export interface RenameDatabaseFormState extends RenameDatabaseParams {}

export interface RenameDatabaseFormProps {
    value: RenameDatabaseFormState;
    viewModel: RenameDatabaseViewModel;
    newNameValidationMessage?: string;
    newNameValidationState: "none" | "error" | "warning" | "success";
    onChange: (next: RenameDatabaseFormState) => void;
}

export const RenameDatabaseForm = ({
    value,
    viewModel,
    newNameValidationMessage,
    newNameValidationState,
    onChange,
}: RenameDatabaseFormProps) => {
    const styles = useStyles();

    return (
        <div className={styles.root}>
            <div className={styles.section}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionTitle}>
                        {locConstants.renameDatabase.detailsSection}
                    </div>
                </div>
                <div className={styles.tableContainer}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th className={styles.tableHeaderCell}>
                                    {locConstants.renameDatabase.nameColumn}
                                </th>
                                <th className={styles.tableHeaderCell}>
                                    {locConstants.renameDatabase.ownerColumn}
                                </th>
                                <th className={styles.tableHeaderCell}>
                                    {locConstants.renameDatabase.statusColumn}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className={styles.tableCell}>
                                    {viewModel.databaseName ??
                                        locConstants.renameDatabase.valueUnknown}
                                </td>
                                <td className={styles.tableCell}>
                                    {viewModel.owner ?? locConstants.renameDatabase.valueUnknown}
                                </td>
                                <td className={styles.tableCell}>
                                    {viewModel.status ?? locConstants.renameDatabase.valueUnknown}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            <div className={styles.section}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionTitle}>
                        {locConstants.renameDatabase.optionsSection}
                    </div>
                </div>
                <div className={styles.fieldGroup}>
                    <Field
                        label={locConstants.renameDatabase.newNameLabel}
                        validationState={newNameValidationState}
                        validationMessage={newNameValidationMessage}>
                        <Input
                            value={value.newName}
                            placeholder={locConstants.renameDatabase.newNamePlaceholder}
                            onChange={(_, data) =>
                                onChange({
                                    ...value,
                                    newName: data.value,
                                })
                            }
                        />
                    </Field>
                    <Checkbox
                        label={locConstants.renameDatabase.dropConnections}
                        checked={value.dropConnections}
                        onChange={(_, data) =>
                            onChange({
                                ...value,
                                dropConnections: !!data.checked,
                            })
                        }
                    />
                </div>
            </div>
        </div>
    );
};
