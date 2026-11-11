/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ReactNode, Ref } from "react";
import {
    Dropdown,
    makeStyles,
    Option,
    OptionGroup,
    Spinner,
    Text,
    tokens,
} from "@fluentui/react-components";
import type { FormItemOptions } from "../../sharedInterfaces/form";
import { ErrorMessageDetails } from "./errorMessageDetails";
import { locConstants as loc } from "./locConstants";
import { SearchableDropdown, type SearchableDropdownOptions } from "./searchableDropdown.component";

const useStyles = makeStyles({
    root: { display: "flex", flexDirection: "column", rowGap: "14px" },
    fieldRow: {
        display: "grid",
        gridTemplateColumns: "140px minmax(0, 1fr)",
        columnGap: "24px",
        alignItems: "start",
        "@media (max-width: 520px)": {
            gridTemplateColumns: "1fr",
            rowGap: "6px",
        },
    },
    fieldLabel: {
        paddingTop: "5px",
        color: tokens.colorNeutralForeground1,
        fontSize: "13px",
        lineHeight: "18px",
        fontWeight: tokens.fontWeightSemibold,
    },
    fieldControl: { minWidth: 0, width: "100%" },
    databaseField: { display: "grid", gap: "8px", minWidth: 0 },
    controlWithStatus: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minWidth: 0,
    },
});

interface DatabaseSelectorProps {
    connections: SearchableDropdownOptions[];
    selectedConnection: SearchableDropdownOptions;
    databases: FormItemOptions[];
    selectedDatabase: string;
    isDatabaseListLoading: boolean;
    databaseListError: string;
    onConnectionSelected: (option: SearchableDropdownOptions) => void;
    onDatabaseSelected: (database: string) => void;
    isConnectionListLoading?: boolean;
    connectionListLoadingMessage?: string;
    connectionListError?: string;
    connectionTriggerRef?: Ref<HTMLButtonElement>;
    connectionAction?: ReactNode;
}

export function DatabaseSelector({
    connections,
    selectedConnection,
    databases,
    selectedDatabase,
    isDatabaseListLoading,
    databaseListError,
    onConnectionSelected,
    onDatabaseSelected,
    isConnectionListLoading = false,
    connectionListLoadingMessage = loc.common.loadingWithEllipsis,
    connectionListError = "",
    connectionTriggerRef,
    connectionAction,
}: DatabaseSelectorProps) {
    const classes = useStyles();
    if (isConnectionListLoading) {
        return <Spinner label={connectionListLoadingMessage} size="medium" />;
    }
    const hasConnections = connections.length > 0 && !connectionListError;
    const connectionOptions = [...connections].sort((left, right) =>
        (left.text ?? left.value).localeCompare(right.text ?? right.value, undefined, {
            numeric: true,
            sensitivity: "base",
        }),
    );
    const databaseGroups = new Map<string, FormItemOptions[]>();
    for (const database of databases) {
        const groupName = database.groupName ?? "";
        const group = databaseGroups.get(groupName) ?? [];
        group.push(database);
        databaseGroups.set(groupName, group);
    }

    return (
        <div className={classes.root}>
            <div className={classes.fieldRow}>
                <Text className={classes.fieldLabel}>{loc.schemaCompare.connection}</Text>
                <div className={classes.controlWithStatus}>
                    <div className={classes.fieldControl}>
                        <SearchableDropdown
                            style={{ width: "100%" }}
                            options={connectionOptions}
                            selectedOption={
                                hasConnections ? selectedConnection : { value: "", text: "" }
                            }
                            onSelect={onConnectionSelected}
                            ariaLabel={loc.schemaCompare.connection}
                            placeholder={
                                hasConnections
                                    ? loc.schemaCompare.selectConnection
                                    : loc.schemaCompare.noConnectionsFound
                            }
                            disabled={!hasConnections}
                            triggerRef={connectionTriggerRef}
                            showPlaceholder
                        />
                    </div>
                    {connectionAction}
                </div>
            </div>
            <div className={classes.fieldRow}>
                <Text className={classes.fieldLabel}>{loc.schemaCompare.database}</Text>
                <div className={classes.databaseField}>
                    <div className={classes.controlWithStatus}>
                        <Dropdown
                            className={classes.fieldControl}
                            aria-label={loc.schemaCompare.database}
                            placeholder={loc.dacpacDialog.selectDatabase}
                            value={
                                isDatabaseListLoading && !selectedDatabase
                                    ? loc.common.loadingWithEllipsis
                                    : !isDatabaseListLoading && databaseListError
                                      ? loc.schemaCompare.noDatabasesFound
                                      : hasConnections
                                        ? selectedDatabase
                                        : ""
                            }
                            selectedOptions={
                                hasConnections && selectedDatabase ? [selectedDatabase] : []
                            }
                            disabled={
                                !hasConnections ||
                                isDatabaseListLoading ||
                                Boolean(databaseListError) ||
                                databases.length === 0
                            }
                            onOptionSelect={(_, data) => {
                                if (data.optionValue) {
                                    onDatabaseSelected(data.optionValue);
                                }
                            }}>
                            {Array.from(databaseGroups.entries()).map(([groupName, options]) => (
                                <OptionGroup key={groupName} label={groupName}>
                                    {options.map((database) => (
                                        <Option key={database.value} value={database.value}>
                                            {database.displayName}
                                        </Option>
                                    ))}
                                </OptionGroup>
                            ))}
                        </Dropdown>
                        {isDatabaseListLoading && (
                            <Spinner
                                size="extra-tiny"
                                aria-label={loc.common.loadingWithEllipsis}
                            />
                        )}
                    </div>
                    {!isDatabaseListLoading && databaseListError && (
                        <ErrorMessageDetails message={databaseListError} />
                    )}
                </div>
            </div>
        </div>
    );
}
