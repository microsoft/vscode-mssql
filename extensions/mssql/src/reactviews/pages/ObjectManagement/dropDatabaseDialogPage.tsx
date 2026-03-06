/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { Image, makeStyles, Spinner, tokens } from "@fluentui/react-components";
import { Warning20Regular } from "@fluentui/react-icons";
import {
    DropDatabaseParams,
    DropDatabaseViewModel,
    ObjectManagementCancelNotification,
    ObjectManagementDialogType,
    ObjectManagementHelpNotification,
    ObjectManagementScriptRequest,
    ObjectManagementSubmitRequest,
} from "../../../sharedInterfaces/objectManagement";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { locConstants } from "../../common/locConstants";
import { getErrorMessage } from "../../common/utils";
import { ObjectManagementDialog } from "../../common/objectManagementDialog";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { ObjectManagementContext } from "./objectManagementStateProvider";
import { DropDatabaseForm, DropDatabaseFormState } from "./dropDatabaseForm";

const databaseLightIcon = require("../../../../media/database_light.svg");
const databaseDarkIcon = require("../../../../media/database_dark.svg");

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
    content: {
        width: "100%",
        maxWidth: "560px",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
    },
    warningCallout: {
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "14px 18px",
        borderRadius: "8px",
        border: "1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground))",
        backgroundColor:
            "color-mix(in srgb, var(--vscode-inputValidation-warningBackground, var(--vscode-editor-background)) 72%, transparent)",
        color: "var(--vscode-foreground)",
    },
    warningIcon: {
        color: "var(--vscode-editorWarning-foreground)",
        flexShrink: 0,
        marginTop: "1px",
    },
    warningText: {
        fontSize: tokens.fontSizeBase300,
        lineHeight: tokens.lineHeightBase300,
    },
    warningEmphasis: {
        color: "var(--vscode-editorWarning-foreground)",
        fontWeight: tokens.fontWeightSemibold,
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
    const { themeKind } = useVscodeWebview();
    const [resultApiError, setResultApiError] = useState<string | undefined>(undefined);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isConfirmed, setIsConfirmed] = useState(false);
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
            icon={
                <Image
                    src={themeKind === ColorThemeKind.Dark ? databaseDarkIcon : databaseLightIcon}
                    alt={locConstants.dropDatabase.title}
                />
            }
            title={dialogTitle ?? locConstants.dropDatabase.title}
            subtitle={
                model
                    ? locConstants.dropDatabase.description(model.databaseName, model.serverName)
                    : undefined
            }
            errorMessage={resultApiError ?? initializationError}
            loadingMessage={isSubmitting ? locConstants.dropDatabase.droppingDatabase : undefined}
            primaryLabel={locConstants.dropDatabase.dropButton}
            cancelLabel={locConstants.dropDatabase.cancelButton}
            helpLabel={locConstants.dropDatabase.helpButton}
            scriptLabel={locConstants.dropDatabase.scriptButton}
            primaryDisabled={isSubmitting || !isConfirmed}
            scriptDisabled={isSubmitting}
            onPrimary={async () => {
                const params: DropDatabaseParams = {
                    ...dropForm,
                };
                setIsSubmitting(true);
                setResultApiError(undefined);
                try {
                    const result = await context?.extensionRpc?.sendRequest(
                        ObjectManagementSubmitRequest.type,
                        { dialogType: ObjectManagementDialogType.DropDatabase, params },
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
                const params: DropDatabaseParams = {
                    ...dropForm,
                };
                try {
                    const result = await context?.extensionRpc?.sendRequest(
                        ObjectManagementScriptRequest.type,
                        { dialogType: ObjectManagementDialogType.DropDatabase, params },
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
                <div className={styles.content}>
                    <div className={styles.warningCallout}>
                        <Warning20Regular className={styles.warningIcon} />
                        <div className={styles.warningText}>
                            {locConstants.dropDatabase.warningMessage(
                                model.databaseName,
                                model.serverName,
                            )}{" "}
                            <span className={styles.warningEmphasis}>
                                {locConstants.dropDatabase.warningEmphasis}
                            </span>
                        </div>
                    </div>
                    <DropDatabaseForm
                        value={dropForm}
                        viewModel={model}
                        isConfirmed={isConfirmed}
                        onChange={(next) => setDropForm(next)}
                        onConfirmationChange={setIsConfirmed}
                    />
                </div>
            )}
        </ObjectManagementDialog>
    );
};
