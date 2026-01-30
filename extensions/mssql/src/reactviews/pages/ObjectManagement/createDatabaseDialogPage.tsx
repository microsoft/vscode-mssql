/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useRef, useState } from "react";
import { makeStyles, Spinner } from "@fluentui/react-components";
import {
    CreateDatabaseParams,
    CreateDatabaseViewModel,
    ObjectManagementCancelNotification,
    ObjectManagementDialogType,
    ObjectManagementHelpNotification,
    ObjectManagementScriptRequest,
    ObjectManagementSubmitRequest,
} from "../../../sharedInterfaces/objectManagement";
import { locConstants } from "../../common/locConstants";
import { getErrorMessage } from "../../common/utils";
import { ObjectManagementDialog } from "../../common/objectManagementDialog";
import { ObjectManagementContext } from "./objectManagementStateProvider";
import { CreateDatabaseForm, CreateDatabaseFormState } from "./createDatabaseForm";

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

export interface CreateDatabaseDialogPageProps {
    model?: CreateDatabaseViewModel;
    isLoading: boolean;
    dialogTitle?: string;
    initializationError?: string;
}

export const CreateDatabaseDialogPage = ({
    model,
    isLoading,
    dialogTitle,
    initializationError,
}: CreateDatabaseDialogPageProps) => {
    const styles = useStyles();
    const context = useContext(ObjectManagementContext);
    const [resultApiError, setResultApiError] = useState<string | undefined>(undefined);
    const [createForm, setCreateForm] = useState<CreateDatabaseFormState | undefined>(undefined);
    const createFormInitialized = useRef(false);

    useEffect(() => {
        if (model) {
            const hasDefaults =
                !!model.databaseName ||
                !!model.ownerOptions?.length ||
                !!model.collationOptions?.length ||
                !!model.recoveryModelOptions?.length ||
                !!model.compatibilityLevelOptions?.length ||
                !!model.containmentTypeOptions?.length ||
                model.isLedgerDatabase !== undefined;

            if (!createFormInitialized.current && hasDefaults) {
                setCreateForm({
                    name: model.databaseName ?? "",
                    owner: model.owner,
                    collationName: model.collationName,
                    recoveryModel: model.recoveryModel,
                    compatibilityLevel: model.compatibilityLevel,
                    containmentType: model.containmentType,
                    isLedgerDatabase: model.isLedgerDatabase,
                });
                createFormInitialized.current = true;
            }
        }
    }, [model, isLoading]);

    const formState = createForm ?? {
        name: model?.databaseName ?? "",
        owner: model?.owner,
        collationName: model?.collationName,
        recoveryModel: model?.recoveryModel,
        compatibilityLevel: model?.compatibilityLevel,
        containmentType: model?.containmentType,
        isLedgerDatabase: model?.isLedgerDatabase,
    };
    const trimmedName = formState.name.trim();
    const isNameEmpty = trimmedName.length === 0;
    const isNameTooLong = trimmedName.length > maxDatabaseNameLength;
    const showNameRequired = formState.name.length > 0 && isNameEmpty;
    const showNameTooLong = !showNameRequired && isNameTooLong;
    const isSubmitDisabled = isLoading || isNameEmpty || isNameTooLong;

    const nameValidationMessage = showNameRequired
        ? locConstants.createDatabase.nameRequired
        : showNameTooLong
          ? locConstants.createDatabase.nameTooLong
          : undefined;

    if (isLoading) {
        return (
            <div className={styles.loadingPage}>
                <Spinner label={locConstants.createDatabase.loading} labelPosition="below" />
            </div>
        );
    }

    return (
        <ObjectManagementDialog
            title={dialogTitle ?? locConstants.createDatabase.title}
            description={
                model ? locConstants.createDatabase.description(model.serverName) : undefined
            }
            errorMessage={resultApiError ?? initializationError}
            primaryLabel={locConstants.createDatabase.createButton}
            cancelLabel={locConstants.createDatabase.cancelButton}
            helpLabel={locConstants.createDatabase.helpButton}
            scriptLabel={locConstants.createDatabase.scriptButton}
            primaryDisabled={isSubmitDisabled}
            scriptDisabled={isSubmitDisabled}
            onPrimary={async () => {
                const params: CreateDatabaseParams = {
                    ...formState,
                    name: trimmedName,
                };
                try {
                    const result = await context?.extensionRpc?.sendRequest(
                        ObjectManagementSubmitRequest.type,
                        { dialogType: ObjectManagementDialogType.CreateDatabase, params },
                    );
                    if (result?.errorMessage) {
                        setResultApiError(result.errorMessage);
                    }
                } catch (error) {
                    setResultApiError(getErrorMessage(error));
                }
            }}
            onScript={async () => {
                const params: CreateDatabaseParams = {
                    ...formState,
                    name: trimmedName,
                };
                try {
                    const result = await context?.extensionRpc?.sendRequest(
                        ObjectManagementScriptRequest.type,
                        { dialogType: ObjectManagementDialogType.CreateDatabase, params },
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
            <CreateDatabaseForm
                value={formState}
                viewModel={model ?? { serverName: "" }}
                nameValidationMessage={nameValidationMessage}
                nameValidationState={showNameRequired || showNameTooLong ? "error" : "none"}
                onChange={(next) => setCreateForm(next)}
            />
        </ObjectManagementDialog>
    );
};
