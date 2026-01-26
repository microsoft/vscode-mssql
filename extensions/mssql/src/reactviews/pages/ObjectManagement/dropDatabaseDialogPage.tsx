/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { makeStyles, Spinner } from "@fluentui/react-components";
import {
    DropDatabaseParams,
    DropDatabaseViewModel,
    ObjectManagementCancelNotification,
    ObjectManagementDialogType,
    ObjectManagementHelpNotification,
    ObjectManagementScriptRequest,
    ObjectManagementSubmitRequest,
} from "../../../sharedInterfaces/objectManagement";
import { locConstants } from "../../common/locConstants";
import { ObjectManagementDialog } from "../../common/objectManagementDialog";
import { ObjectManagementContext } from "./objectManagementStateProvider";
import { DropDatabaseForm, DropDatabaseFormState } from "./dropDatabaseForm";

const useStyles = makeStyles({
    loadingPage: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        width: "100%",
        flexDirection: "column",
        backgroundColor: "var(--vscode-editor-background)",
    },
});

export interface DropDatabaseDialogPageProps {
    model?: DropDatabaseViewModel;
    isLoading: boolean;
    dialogTitle?: string;
    initializationError?: string;
}

export const DropDatabaseDialogPage = ({
    model,
    isLoading,
    dialogTitle,
    initializationError,
}: DropDatabaseDialogPageProps) => {
    const styles = useStyles();
    const context = useContext(ObjectManagementContext);
    const [resultApiError, setResultApiError] = useState<string | undefined>(undefined);
    const [dropForm, setDropForm] = useState<DropDatabaseFormState>({
        dropConnections: false,
        deleteBackupHistory: false,
    });

    if (isLoading) {
        return (
            <div className={styles.loadingPage}>
                <Spinner label={locConstants.dropDatabase.loading} labelPosition="below" />
            </div>
        );
    }

    return (
        <ObjectManagementDialog
            title={dialogTitle ?? locConstants.dropDatabase.title}
            description={
                model
                    ? locConstants.dropDatabase.description(model.databaseName, model.serverName)
                    : undefined
            }
            errorMessage={resultApiError ?? initializationError}
            primaryLabel={locConstants.dropDatabase.dropButton}
            cancelLabel={locConstants.dropDatabase.cancelButton}
            helpLabel={locConstants.dropDatabase.helpButton}
            scriptLabel={locConstants.dropDatabase.scriptButton}
            primaryDisabled={false}
            scriptDisabled={false}
            onPrimary={async () => {
                const params: DropDatabaseParams = {
                    ...dropForm,
                };
                const result = await context?.extensionRpc?.sendRequest(
                    ObjectManagementSubmitRequest.type,
                    { dialogType: ObjectManagementDialogType.DropDatabase, params },
                );
                if (result?.errorMessage) {
                    setResultApiError(result.errorMessage);
                }
            }}
            onScript={async () => {
                const params: DropDatabaseParams = {
                    ...dropForm,
                };
                const result = await context?.extensionRpc?.sendRequest(
                    ObjectManagementScriptRequest.type,
                    { dialogType: ObjectManagementDialogType.DropDatabase, params },
                );
                if (result?.errorMessage) {
                    setResultApiError(result.errorMessage);
                }
            }}
            onHelp={() => {
                void context?.extensionRpc?.sendNotification(ObjectManagementHelpNotification.type);
            }}
            onCancel={() => {
                void context?.extensionRpc?.sendNotification(
                    ObjectManagementCancelNotification.type,
                );
            }}>
            {model && (
                <DropDatabaseForm
                    value={dropForm}
                    viewModel={model}
                    onChange={(next) => setDropForm(next)}
                />
            )}
        </ObjectManagementDialog>
    );
};
