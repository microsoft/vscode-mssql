/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useRef, useState } from "react";
import { makeStyles, Spinner } from "@fluentui/react-components";
import {
    ObjectManagementCancelNotification,
    ObjectManagementDialogType,
    ObjectManagementHelpNotification,
    ObjectManagementScriptRequest,
    ObjectManagementSubmitRequest,
    RenameDatabaseParams,
    RenameDatabaseViewModel,
} from "../../../sharedInterfaces/objectManagement";
import { locConstants } from "../../common/locConstants";
import { getErrorMessage } from "../../common/utils";
import { ObjectManagementDialog } from "../../common/objectManagementDialog";
import { RenameDatabaseIcon } from "../../common/icons/renameDatabase";
import { ObjectManagementContext } from "./objectManagementStateProvider";
import { RenameDatabaseForm, RenameDatabaseFormState } from "./renameDatabaseForm";

const maxDatabaseNameLength = 128;

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

export interface RenameDatabaseDialogPageProps {
    model?: RenameDatabaseViewModel;
    isLoading: boolean;
    dialogTitle?: string;
    initializationError?: string;
}

export const RenameDatabaseDialogPage = ({
    model,
    isLoading,
    dialogTitle,
    initializationError,
}: RenameDatabaseDialogPageProps) => {
    const styles = useStyles();
    const context = useContext(ObjectManagementContext);
    const [resultApiError, setResultApiError] = useState<string | undefined>(undefined);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [renameForm, setRenameForm] = useState<RenameDatabaseFormState>({
        newName: model?.newDatabaseName ?? model?.databaseName ?? "",
        dropConnections: false,
    });
    const renameFormInitialized = useRef(false);

    useEffect(() => {
        if (model && !renameFormInitialized.current) {
            setRenameForm({
                newName: model.newDatabaseName ?? model.databaseName,
                dropConnections: false,
            });
            renameFormInitialized.current = true;
        }
    }, [model]);

    const trimmedName = renameForm.newName.trim();
    const currentDatabaseName = model?.databaseName.trim() ?? "";
    const isNameEmpty = trimmedName.length === 0;
    const isNameTooLong = trimmedName.length > maxDatabaseNameLength;
    const isNameUnchanged = trimmedName === currentDatabaseName;
    const showNameRequired = renameForm.newName.length > 0 && isNameEmpty;
    const showNameTooLong = !showNameRequired && isNameTooLong;
    const showNameUnchanged = !showNameRequired && !showNameTooLong && isNameUnchanged;
    const isSubmitDisabled =
        isLoading || isSubmitting || isNameEmpty || isNameTooLong || isNameUnchanged;

    const newNameValidationMessage = showNameRequired
        ? locConstants.renameDatabase.newNameRequired
        : showNameTooLong
          ? locConstants.renameDatabase.newNameTooLong
          : showNameUnchanged
            ? locConstants.renameDatabase.newNameUnchanged
            : undefined;

    if (isLoading) {
        return (
            <div className={styles.loadingPage}>
                <Spinner label={locConstants.renameDatabase.loading} labelPosition="below" />
            </div>
        );
    }

    return (
        <ObjectManagementDialog
            icon={<RenameDatabaseIcon aria-label={locConstants.renameDatabase.title} />}
            title={dialogTitle ?? locConstants.renameDatabase.title}
            subtitle={
                model
                    ? locConstants.renameDatabase.description(model.databaseName, model.serverName)
                    : undefined
            }
            errorMessage={resultApiError ?? initializationError}
            loadingMessage={isSubmitting ? locConstants.renameDatabase.renamingDatabase : undefined}
            primaryLabel={locConstants.renameDatabase.renameButton}
            cancelLabel={locConstants.renameDatabase.cancelButton}
            helpLabel={locConstants.renameDatabase.helpButton}
            scriptLabel={locConstants.renameDatabase.scriptButton}
            primaryDisabled={isSubmitDisabled}
            scriptDisabled={isSubmitDisabled}
            onPrimary={async () => {
                const params: RenameDatabaseParams = {
                    ...renameForm,
                    newName: trimmedName,
                };
                setIsSubmitting(true);
                setResultApiError(undefined);
                try {
                    const result = await context?.extensionRpc?.sendRequest(
                        ObjectManagementSubmitRequest.type,
                        { dialogType: ObjectManagementDialogType.RenameDatabase, params },
                    );
                    if (result?.errorMessage) {
                        setResultApiError(result.errorMessage);
                        setIsSubmitting(false);
                    }
                } catch (error) {
                    setResultApiError(getErrorMessage(error));
                    setIsSubmitting(false);
                }
            }}
            onScript={async () => {
                const params: RenameDatabaseParams = {
                    ...renameForm,
                    newName: trimmedName,
                };
                try {
                    const result = await context?.extensionRpc?.sendRequest(
                        ObjectManagementScriptRequest.type,
                        { dialogType: ObjectManagementDialogType.RenameDatabase, params },
                    );
                    if (result?.errorMessage) {
                        setResultApiError(result.errorMessage);
                    }
                } catch (error) {
                    setResultApiError(getErrorMessage(error));
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
                <RenameDatabaseForm
                    value={renameForm}
                    viewModel={model}
                    newNameValidationMessage={newNameValidationMessage}
                    newNameValidationState={
                        showNameRequired || showNameTooLong || showNameUnchanged ? "error" : "none"
                    }
                    onChange={(next) => setRenameForm(next)}
                />
            )}
        </ObjectManagementDialog>
    );
};
