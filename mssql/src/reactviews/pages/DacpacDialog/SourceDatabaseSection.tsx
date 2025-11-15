/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dropdown, Field, Input, makeStyles, Option } from "@fluentui/react-components";
import { locConstants } from "../../common/locConstants";

/**
 * Validation message with severity level
 */
interface ValidationMessage {
    message: string;
    severity: "error" | "warning";
}

interface SourceDatabaseSectionProps {
    databaseName: string;
    setDatabaseName: (value: string) => void;
    availableDatabases: string[];
    isOperationInProgress: boolean;
    ownerUri: string;
    validationMessages: Record<string, ValidationMessage>;
    showDatabaseSource: boolean;
    showNewDatabase: boolean;
    isFabric?: boolean;
}

const useStyles = makeStyles({
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
});

export const SourceDatabaseSection = ({
    databaseName,
    setDatabaseName,
    availableDatabases,
    isOperationInProgress,
    ownerUri,
    validationMessages,
    showDatabaseSource,
    showNewDatabase,
    isFabric = false,
}: SourceDatabaseSectionProps) => {
    const classes = useStyles();

    return (
        <div className={classes.section}>
            {showDatabaseSource ? (
                <Field
                    label={locConstants.dacpacDialog.sourceDatabaseLabel}
                    required
                    validationMessage={
                        validationMessages.databaseName?.message ||
                        validationMessages.database?.message
                    }
                    validationState={
                        validationMessages.databaseName?.severity === "error" ||
                        validationMessages.database?.severity === "error"
                            ? "error"
                            : "none"
                    }>
                    <Dropdown
                        placeholder={locConstants.dacpacDialog.selectDatabase}
                        value={databaseName}
                        selectedOptions={[databaseName]}
                        onOptionSelect={(_, data) => setDatabaseName(data.optionText || "")}
                        disabled={isOperationInProgress || !ownerUri || isFabric}
                        aria-label={locConstants.dacpacDialog.sourceDatabaseLabel}>
                        {availableDatabases.map((db) => (
                            <Option key={db} value={db}>
                                {db}
                            </Option>
                        ))}
                    </Dropdown>
                </Field>
            ) : (
                showNewDatabase && (
                    <Field
                        label={locConstants.dacpacDialog.databaseNameLabel}
                        required
                        validationMessage={validationMessages.databaseName?.message}
                        validationState={
                            validationMessages.databaseName?.severity === "error" ? "error" : "none"
                        }>
                        <Input
                            value={databaseName}
                            onChange={(_, data) => setDatabaseName(data.value)}
                            placeholder={locConstants.dacpacDialog.enterDatabaseName}
                            disabled={isOperationInProgress || isFabric}
                            aria-label={locConstants.dacpacDialog.databaseNameLabel}
                        />
                    </Field>
                )
            )}
        </div>
    );
};
