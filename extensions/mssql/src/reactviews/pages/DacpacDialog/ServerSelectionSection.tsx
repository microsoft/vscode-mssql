/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dropdown, Field, Link, makeStyles, Option, Spinner } from "@fluentui/react-components";
import { IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { locConstants } from "../../common/locConstants";

/**
 * Validation message with severity level
 */
interface ValidationMessage {
    message: string;
    severity: "error" | "warning";
}

interface ServerSelectionSectionProps {
    selectedProfileId: string;
    availableConnections: IConnectionDialogProfile[];
    isConnecting: boolean;
    isOperationInProgress: boolean;
    validationMessages: Record<string, ValidationMessage>;
    onServerChange: (profileId: string) => void;
    isFabric?: boolean;
}

const useStyles = makeStyles({
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    fabricWarning: {
        marginTop: "4px",
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
    },
});

export const ServerSelectionSection = ({
    selectedProfileId,
    availableConnections,
    isConnecting,
    isOperationInProgress,
    validationMessages,
    onServerChange,
    isFabric = false,
}: ServerSelectionSectionProps) => {
    const classes = useStyles();

    return (
        <div className={classes.section}>
            <Field
                label={locConstants.dacpacDialog.serverLabel}
                required
                validationMessage={isFabric ? undefined : validationMessages.connection?.message}
                validationState={
                    !isFabric && validationMessages.connection?.severity === "error"
                        ? "error"
                        : "none"
                }>
                {isConnecting ? (
                    <Spinner size="tiny" label={locConstants.dacpacDialog.connectingToServer} />
                ) : (
                    <Dropdown
                        placeholder={locConstants.dacpacDialog.selectServer}
                        value={
                            selectedProfileId
                                ? (() => {
                                      const conn = availableConnections.find(
                                          (conn) => conn.id === selectedProfileId,
                                      );
                                      return conn?.profileName || "";
                                  })()
                                : ""
                        }
                        selectedOptions={selectedProfileId ? [selectedProfileId] : []}
                        onOptionSelect={(_, data) => {
                            onServerChange(data.optionValue as string);
                        }}
                        disabled={isOperationInProgress || availableConnections.length === 0}
                        aria-label={locConstants.dacpacDialog.serverLabel}>
                        {availableConnections.length === 0 ? (
                            <Option value="" disabled text="">
                                {locConstants.dacpacDialog.noConnectionsAvailable}
                            </Option>
                        ) : (
                            availableConnections.map((conn) => (
                                <Option
                                    key={conn.id}
                                    value={conn.id!}
                                    text={conn.profileName || ""}>
                                    {conn.profileName}
                                </Option>
                            ))
                        )}
                    </Dropdown>
                )}
            </Field>
            {isFabric && (
                <div className={classes.fabricWarning}>
                    {locConstants.dacpacDialog.fabricWarning}{" "}
                    <Link
                        href="https://github.com/microsoft/vscode-mssql/issues/20568"
                        target="_blank">
                        {locConstants.dacpacDialog.fabricWarningLearnMore}
                    </Link>
                </div>
            )}
        </div>
    );
};
