/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dropdown, Field, Input, makeStyles, Option, Spinner } from "@fluentui/react-components";
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
    isLoadingDatabases?: boolean;
    isDatabaseListUnavailable?: boolean;
    newDatabaseNameExists?: boolean;
}

const useStyles = makeStyles({
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
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

export const SourceDatabaseSection = ({
    databaseName,
    setDatabaseName,
    availableDatabases,
    isOperationInProgress,
    ownerUri,
    validationMessages,
    showDatabaseSource,
    showNewDatabase,
    isLoadingDatabases = false,
    isDatabaseListUnavailable = false,
    newDatabaseNameExists = false,
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
                                    : databaseName
                            }
                            selectedOptions={isLoadingDatabases ? [] : [databaseName]}
                            onOptionSelect={(_, data) => setDatabaseName(data.optionText || "")}
                            disabled={
                                isLoadingDatabases ||
                                isOperationInProgress ||
                                !ownerUri ||
                                isDatabaseListUnavailable
                            }
                            aria-label={locConstants.dacpacDialog.sourceDatabaseLabel}>
                            {availableDatabases.map((db) => (
                                <Option key={db} value={db}>
                                    {db}
                                </Option>
                            ))}
                        </Dropdown>
                    </div>
                </Field>
            ) : (
                showNewDatabase && (
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
                            value={databaseName}
                            onChange={(_, data) => setDatabaseName(data.value)}
                            placeholder={locConstants.dacpacDialog.enterDatabaseName}
                            disabled={isOperationInProgress || isDatabaseListUnavailable}
                            aria-label={locConstants.dacpacDialog.databaseNameLabel}
                        />
                    </Field>
                )
            )}
        </div>
    );
};
