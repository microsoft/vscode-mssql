/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dropdown, Field, makeStyles, Option, Spinner } from "@fluentui/react-components";
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
}

const useStyles = makeStyles({
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
});

export const ServerSelectionSection = ({
    selectedProfileId,
    availableConnections,
    isConnecting,
    isOperationInProgress,
    validationMessages,
    onServerChange,
}: ServerSelectionSectionProps) => {
    const classes = useStyles();

    return (
        <div className={classes.section}>
            <Field
                label={locConstants.dacFxApplication.serverLabel}
                required
                validationMessage={validationMessages.connection?.message}
                validationState={
                    validationMessages.connection?.severity === "error" ? "error" : "none"
                }>
                {isConnecting ? (
                    <Spinner size="tiny" label={locConstants.dacFxApplication.connectingToServer} />
                ) : (
                    <Dropdown
                        placeholder={locConstants.dacFxApplication.selectServer}
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
                        aria-label={locConstants.dacFxApplication.serverLabel}>
                        {availableConnections.length === 0 ? (
                            <Option value="" disabled text="">
                                {locConstants.dacFxApplication.noConnectionsAvailable}
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
        </div>
    );
};
