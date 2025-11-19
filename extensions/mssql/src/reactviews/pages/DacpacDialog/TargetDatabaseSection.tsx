/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Dropdown,
    Field,
    Input,
    Label,
    makeStyles,
    Option,
    Radio,
    RadioGroup,
} from "@fluentui/react-components";
import { locConstants } from "../../common/locConstants";

/**
 * Validation message with severity level
 */
interface ValidationMessage {
    message: string;
    severity: "error" | "warning";
}

interface TargetDatabaseSectionProps {
    databaseName: string;
    setDatabaseName: (value: string) => void;
    isNewDatabase: boolean;
    setIsNewDatabase: (value: boolean) => void;
    availableDatabases: string[];
    isOperationInProgress: boolean;
    ownerUri: string;
    validationMessages: Record<string, ValidationMessage>;
    isFabric?: boolean;
}

const useStyles = makeStyles({
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    radioGroup: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
});

export const TargetDatabaseSection = ({
    databaseName,
    setDatabaseName,
    isNewDatabase,
    setIsNewDatabase,
    availableDatabases,
    isOperationInProgress,
    ownerUri,
    validationMessages,
    isFabric = false,
}: TargetDatabaseSectionProps) => {
    const classes = useStyles();

    return (
        <div className={classes.section}>
            <Label>{locConstants.dacpacDialog.targetDatabaseLabel}</Label>
            <RadioGroup
                value={isNewDatabase ? "new" : "existing"}
                onChange={(_, data) => setIsNewDatabase(data.value === "new")}
                className={classes.radioGroup}
                aria-label={locConstants.dacpacDialog.targetDatabaseLabel}>
                <Radio
                    value="new"
                    label={locConstants.dacpacDialog.newDatabase}
                    disabled={isOperationInProgress || isFabric}
                    aria-label={locConstants.dacpacDialog.newDatabase}
                />
                <Radio
                    value="existing"
                    label={locConstants.dacpacDialog.existingDatabase}
                    disabled={isOperationInProgress}
                    aria-label={locConstants.dacpacDialog.existingDatabase}
                />
            </RadioGroup>

            {isNewDatabase ? (
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
                        disabled={isOperationInProgress}
                        aria-label={locConstants.dacpacDialog.databaseNameLabel}
                    />
                </Field>
            ) : (
                <Field
                    label={locConstants.dacpacDialog.databaseNameLabel}
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
                        disabled={isOperationInProgress || !ownerUri}
                        aria-label={locConstants.dacpacDialog.databaseNameLabel}>
                        {availableDatabases.map((db) => (
                            <Option key={db} value={db}>
                                {db}
                            </Option>
                        ))}
                    </Dropdown>
                </Field>
            )}
        </div>
    );
};
