/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants } from "../../../common/locConstants";
import { ObjectManagementDialog } from "../../../common/objectManagementDialog";
import {
    DisasterRecoveryType,
    ObjectManagementCancelNotification,
    ObjectManagementHelpNotification,
} from "../../../../sharedInterfaces/objectManagement";
import { RestoreDatabaseContext } from "./restoreDatabaseStateProvider";
import { RestoreDatabaseViewModel } from "../../../../sharedInterfaces/restore";
import { RestoreDatabaseForm } from "./restoreDatabaseForm";
import { useRestoreDatabaseSelector } from "./restoreDatabaseSelector";

const useStyles = makeStyles({
    outerDiv: {
        height: "100%",
        width: "100%",
        position: "relative",
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

export const RestoreDatabaseDialogPage = () => {
    const classes = useStyles();
    const context = useContext(RestoreDatabaseContext);

    if (!context) {
        return null;
    }

    const loadState = useRestoreDatabaseSelector(
        (s) => (s.viewModel.model as RestoreDatabaseViewModel).loadState,
    );
    const errorMessage = useRestoreDatabaseSelector(
        (s) => (s.viewModel.model as RestoreDatabaseViewModel).errorMessage,
    );
    const restoreType = useRestoreDatabaseSelector(
        (s) => (s.viewModel.model as RestoreDatabaseViewModel).type,
    );
    const formComponents = useRestoreDatabaseSelector((s) => s.formComponents);
    const formErrors = useRestoreDatabaseSelector((s) => s.formErrors);
    const formState = useRestoreDatabaseSelector((s) => s.formState);
    const backupFiles = useRestoreDatabaseSelector(
        (s) => (s.viewModel.model as RestoreDatabaseViewModel).backupFiles,
    );
    const restorePlanStatus = useRestoreDatabaseSelector(
        (s) => (s.viewModel.model as RestoreDatabaseViewModel).restorePlanStatus,
    );

    const [fileErrors, setFileErrors] = useState<number[]>([]);

    const shouldDisableRestoreButton = (): boolean => {
        const requiredComponents = Object.values(formComponents).filter((component) => {
            if (!component.required) {
                return false;
            }
            if (component.propertyName === "targetDatabaseName") {
                return true;
            }

            return component.groupName === restoreType;
        });

        const hasMissingRequiredValue = requiredComponents.some((component) => {
            const value = formState[component.propertyName as keyof typeof formState];
            return value === undefined || value === null || value === "";
        });

        const hasNoBackupFiles =
            restoreType === DisasterRecoveryType.BackupFile && backupFiles.length === 0;

        const hasFormErrors = formErrors.length > 0;

        return (
            hasMissingRequiredValue ||
            hasNoBackupFiles ||
            hasFormErrors ||
            fileErrors.length > 0 ||
            restorePlanStatus !== ApiStatus.Loaded
        );
    };

    const renderMainContent = () => {
        switch (loadState) {
            case ApiStatus.Loading:
                return (
                    <div className={classes.spinnerDiv}>
                        <Spinner
                            label={locConstants.restoreDatabase.loadingRestoreDatabase}
                            labelPosition="below"
                        />
                    </div>
                );
            case ApiStatus.Loaded:
                return (
                    <ObjectManagementDialog
                        title={undefined}
                        description={undefined}
                        errorMessage={errorMessage}
                        primaryLabel={locConstants.restoreDatabase.restore}
                        cancelLabel={locConstants.createDatabase.cancelButton}
                        helpLabel={locConstants.createDatabase.helpButton}
                        scriptLabel={locConstants.backupDatabase.script}
                        primaryDisabled={shouldDisableRestoreButton()}
                        scriptDisabled={false}
                        onPrimary={() => {
                            context.restoreDatabase();
                        }}
                        onScript={async () => {
                            context.openRestoreScript();
                        }}
                        onHelp={() => {
                            void context?.extensionRpc.sendNotification(
                                ObjectManagementHelpNotification.type,
                            );
                        }}
                        onCancel={() => {
                            void context?.extensionRpc.sendNotification(
                                ObjectManagementCancelNotification.type,
                            );
                        }}>
                        <RestoreDatabaseForm
                            fileErrors={fileErrors}
                            setFileErrors={setFileErrors}
                        />
                    </ObjectManagementDialog>
                );
            case ApiStatus.Error:
                return (
                    <div className={classes.spinnerDiv}>
                        <ErrorCircleRegular className={classes.errorIcon} />
                        <Text size={400}>{errorMessage ?? ""}</Text>
                    </div>
                );
        }
    };

    return <div className={classes.outerDiv}>{renderMainContent()}</div>;
};
