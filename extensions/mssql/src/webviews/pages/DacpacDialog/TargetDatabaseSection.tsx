/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Dropdown,
    Field,
    Input,
    makeStyles,
    Option,
    Radio,
    RadioGroup,
    Spinner,
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
    newDatabaseName: string;
    setNewDatabaseName: (value: string) => void;
    existingDatabaseName: string;
    setExistingDatabaseName: (value: string) => void;
    isNewDatabase: boolean;
    setIsNewDatabase: (value: boolean) => void;
    availableDatabases: string[];
    isOperationInProgress: boolean;
    ownerUri: string;
    validationMessages: Record<string, ValidationMessage>;
    isFabric?: boolean;
    isLoadingDatabases?: boolean;
    newDatabaseNameExists?: boolean;
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
    databaseControl: {
        position: "relative",
        width: "100%",
    },
    spinner: {
        position: "absolute",
        right: "calc(100% + 12px)",
        top: "50%",
        transform: "translateY(-50%)",
    },
    dropdown: {
        width: "100%",
    },
    labelWithSpinner: {
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
    },
});

export const TargetDatabaseSection = ({
    newDatabaseName,
    setNewDatabaseName,
    existingDatabaseName,
    setExistingDatabaseName,
    isNewDatabase,
    setIsNewDatabase,
    availableDatabases,
    isOperationInProgress,
    ownerUri,
    validationMessages,
    isFabric = false,
    isLoadingDatabases = false,
    newDatabaseNameExists = false,
}: TargetDatabaseSectionProps) => {
    const classes = useStyles();

    return (
        <div className={classes.section}>
            <Field label={locConstants.dacpacDialog.targetDatabaseLabel} orientation="horizontal">
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
            </Field>

            {isNewDatabase ? (
                <Field
                    label={
                        <span className={classes.labelWithSpinner}>
                            {locConstants.dacpacDialog.databaseNameLabel}
                            {isLoadingDatabases && (
                                <Spinner
                                    size="extra-tiny"
                                    aria-label={locConstants.dacpacDialog.loadingDatabases}
                                />
                            )}
                        </span>
                    }
                    required
                    validationMessage={
                        validationMessages.databaseName?.message ||
                        (newDatabaseNameExists
                            ? locConstants.dacpacDialog.databaseAlreadyExists
                            : undefined)
                    }
                    validationState={
                        validationMessages.databaseName?.severity ||
                        (newDatabaseNameExists ? "warning" : "none")
                    }
                    orientation="horizontal">
                    <Input
                        value={newDatabaseName}
                        onChange={(_, data) => setNewDatabaseName(data.value)}
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
                    }
                    orientation="horizontal">
                    <div className={classes.databaseControl}>
                        {isLoadingDatabases && (
                            <Spinner
                                className={classes.spinner}
                                size="tiny"
                                aria-label={locConstants.dacpacDialog.loadingDatabases}
                            />
                        )}
                        <Dropdown
                            className={classes.dropdown}
                            placeholder={
                                isLoadingDatabases
                                    ? locConstants.dacpacDialog.loadingDatabases
                                    : locConstants.dacpacDialog.selectDatabase
                            }
                            value={
                                isLoadingDatabases
                                    ? locConstants.dacpacDialog.loadingDatabases
                                    : existingDatabaseName
                            }
                            selectedOptions={isLoadingDatabases ? [] : [existingDatabaseName]}
                            onOptionSelect={(_, data) =>
                                setExistingDatabaseName(data.optionText || "")
                            }
                            disabled={isLoadingDatabases || isOperationInProgress || !ownerUri}
                            aria-label={locConstants.dacpacDialog.databaseNameLabel}>
                            {availableDatabases.map((db) => (
                                <Option key={db} value={db}>
                                    {db}
                                </Option>
                            ))}
                        </Dropdown>
                    </div>
                </Field>
            )}
        </div>
    );
};
