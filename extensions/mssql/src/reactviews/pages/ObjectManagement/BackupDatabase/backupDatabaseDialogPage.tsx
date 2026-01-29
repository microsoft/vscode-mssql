/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants } from "../../../common/locConstants";
import { BackupDatabaseContext } from "./backupDatabaseStateProvider";
import { BackupDatabaseForm } from "./backupDatabaseForm";
import { ObjectManagementDialog } from "../../../common/objectManagementDialog";
import {
    ObjectManagementCancelNotification,
    ObjectManagementHelpNotification,
} from "../../../../sharedInterfaces/objectManagement";
import { useObjectManagementSelector } from "../objectManagementSelector";
import { BackupDatabaseViewModel } from "../../../../sharedInterfaces/backup";
import { url } from "../../../common/constants";

const useStyles = makeStyles({
    outerDiv: {
        height: "100%",
        width: "100%",
        position: "relative",
        overflowY: "auto",
        overflowX: "unset",
    },
    spinnerDiv: {
        height: "100%",
        width: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: "20px",
    },
    errorIcon: {
        fontSize: "100px",
        opacity: 0.5,
    },
});

export const BackupDatabaseDialogPage = () => {
    const classes = useStyles();
    const context = useContext(BackupDatabaseContext);
    const state = useObjectManagementSelector((state) => state);

    if (!context || !state) {
        return;
    }

    const [fileErrors, setFileErrors] = useState<number[]>([]);
    const backupViewModel = state.viewModel.model as BackupDatabaseViewModel;

    const shouldDisableBackupButton = (): boolean => {
        const formComponents = state.formComponents;
        const isUrlBackup = backupViewModel.saveToUrl;

        const requiredComponents = Object.values(formComponents).filter((component) => {
            if (!component.required) {
                return false;
            }

            return isUrlBackup ? component.groupName === url : component.groupName !== url;
        });

        const hasMissingRequiredValue = requiredComponents.some((component) => {
            const value = state.formState[component.propertyName as keyof typeof state.formState];
            return value === undefined || value === null || value === "";
        });

        const hasFormErrors = state.formErrors.length > 0;
        const hasNoBackupFiles = !isUrlBackup && backupViewModel.backupFiles.length === 0;
        const hasFileErrors = !isUrlBackup && fileErrors.length > 0;
        const isAzureNotReady =
            isUrlBackup &&
            backupViewModel.azureComponentStatuses["blobContainerId"] !== ApiStatus.Loaded;
        return (
            hasMissingRequiredValue ||
            hasFormErrors ||
            hasNoBackupFiles ||
            hasFileErrors ||
            isAzureNotReady
        );
    };

    const renderMainContent = () => {
        switch (backupViewModel?.loadState) {
            case ApiStatus.Loading:
                return (
                    <div className={classes.spinnerDiv}>
                        <Spinner
                            label={locConstants.backupDatabase.loadingBackupDatabase}
                            labelPosition="below"
                        />
                    </div>
                );
            case ApiStatus.Loaded:
                return (
                    <ObjectManagementDialog
                        title={undefined}
                        description={undefined}
                        errorMessage={state?.errorMessage}
                        primaryLabel={locConstants.backupDatabase.backup}
                        cancelLabel={locConstants.createDatabase.cancelButton}
                        helpLabel={locConstants.createDatabase.helpButton}
                        scriptLabel={locConstants.backupDatabase.script}
                        primaryDisabled={shouldDisableBackupButton()}
                        scriptDisabled={false}
                        onPrimary={() => {
                            context.backupDatabase();
                        }}
                        onScript={async () => {
                            context.openBackupScript();
                        }}
                        onHelp={() => {
                            void context?.extensionRpc?.sendNotification(
                                ObjectManagementHelpNotification.type,
                            );
                        }}
                        onCancel={() => {
                            void context?.extensionRpc?.sendNotification(
                                ObjectManagementCancelNotification.type,
                            );
                        }}>
                        <BackupDatabaseForm fileErrors={fileErrors} setFileErrors={setFileErrors} />
                    </ObjectManagementDialog>
                );
            case ApiStatus.Error:
                return (
                    <div className={classes.spinnerDiv}>
                        <ErrorCircleRegular className={classes.errorIcon} />
                        <Text size={400}>{state?.errorMessage ?? ""}</Text>
                    </div>
                );
        }
    };

    return <div className={classes.outerDiv}>{renderMainContent()}</div>;
};
