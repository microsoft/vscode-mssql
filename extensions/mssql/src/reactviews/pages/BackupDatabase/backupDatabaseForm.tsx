/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import {
    Button,
    Dropdown,
    Field,
    Image,
    makeStyles,
    Radio,
    RadioGroup,
    Spinner,
    Text,
    tokens,
} from "@fluentui/react-components";
import { locConstants } from "../../common/locConstants";
import { BackupDatabaseContext } from "./backupDatabaseStateProvider";
import {
    BackupDatabaseFormItemSpec,
    BackupDatabaseFormState,
    BackupDatabaseProvider,
    BackupDatabaseState,
} from "../../../sharedInterfaces/backup";
import { FileBrowserDialog } from "../../common/FileBrowserDialog";
import { FileBrowserProvider } from "../../../sharedInterfaces/fileBrowser";
import { AdvancedOptionsDrawer } from "./backupAdvancedOptions";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { AzureIcon20 } from "../../common/icons/fluentIcons";
import { Save20Regular } from "@fluentui/react-icons";
import { url } from "../../common/constants";
import { azureLogoColor } from "../ConnectionDialog/azureBrowsePage";
import { BackupFileCard } from "./backupFileCard";
import { ApiStatus, ColorThemeKind } from "../../../sharedInterfaces/webview";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        marginLeft: "5px",
        marginRight: "5px",
        padding: "8px",
        whiteSpace: "nowrap",
        width: "650px",
        height: "100%",
    },
    button: {
        height: "32px",
        width: "160px",
    },
    bottomDiv: {
        marginTop: "auto",
        paddingBottom: "50px",
    },
    formDiv: {
        padding: "10px",
        flexGrow: 1,
    },
    header: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
    },
    saveOption: {
        display: "flex",
        alignItems: "center",
    },
    fileDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    fileButtons: {
        display: "flex",
        flexDirection: "row",
        gap: "8px",
        marginLeft: "10px",
    },
    buttonDiv: {
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        gap: "8px",
    },
    leftButtonDiv: {
        display: "flex",
        alignItems: "center",
    },
    rightButtonDiv: {
        display: "flex",
        gap: "8px",
        alignItems: "center",
    },
    icon: {
        width: "75px",
        height: "75px",
        marginBottom: "10px",
    },
    azureLoadingContainer: {
        marginTop: "20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        paddingTop: "20px",
    },
    formLoadingLabel: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    fileList: {
        display: "flex",
        flexDirection: "column",
        padding: "10px",
        gap: "8px",
    },
});

const databaseIconLight = require("../../../../media/database_light.svg");
const databaseIconDark = require("../../../../media/database_dark.svg");

export const BackupDatabaseForm: React.FC = () => {
    const classes = useStyles();
    const context = useContext(BackupDatabaseContext);

    const state = context?.state;

    if (!context || !state) {
        return;
    }

    const formStyles = useFormStyles();
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);
    const [fileErrors, setFileErrors] = useState<number[]>([]);
    const { formComponents } = state;

    const renderFormFields = () =>
        Object.values(formComponents)
            .filter((component) => !component.groupName)
            .map((component, index) => (
                <div
                    key={index}
                    className={formStyles.formComponentDiv}
                    style={{ padding: "10px" }}>
                    <FormField<
                        BackupDatabaseFormState,
                        BackupDatabaseState,
                        BackupDatabaseFormItemSpec,
                        BackupDatabaseProvider
                    >
                        context={context}
                        component={component}
                        idx={index}
                    />
                </div>
            ));

    const renderBackupSaveToUrlFields = () =>
        Object.values(formComponents)
            .filter((component) => component.groupName === url)
            .map((component, index) => {
                const loadStatus = state.azureComponentStatuses[component.propertyName];
                // Trigger loading only if not started or loaded
                if (loadStatus === ApiStatus.NotStarted) {
                    handleLoadAzureComponents();
                }

                return loadStatus === ApiStatus.Loaded || loadStatus === ApiStatus.Error ? (
                    <div
                        key={index}
                        className={formStyles.formComponentDiv}
                        style={{ padding: "10px" }}>
                        <FormField<
                            BackupDatabaseFormState,
                            BackupDatabaseState,
                            BackupDatabaseFormItemSpec,
                            BackupDatabaseProvider
                        >
                            context={context}
                            component={component}
                            idx={index}
                        />
                    </div>
                ) : (
                    <Field
                        key={index}
                        label={
                            <div className={classes.formLoadingLabel}>
                                <Text>{component.label}</Text>
                                <Spinner size="extra-tiny" />
                            </div>
                        }
                        className={formStyles.formComponentDiv}
                        style={{ padding: "10px", marginLeft: "8px" }}>
                        <Dropdown size="small" placeholder={locConstants.backupDatabase.loading} />
                    </Field>
                );
            });

    const renderMediaFields = () =>
        Object.values(formComponents)
            .filter((component) => component.groupName == locConstants.backupDatabase.media)
            .map((component, index) => (
                <div key={index}>
                    <FormField<
                        BackupDatabaseFormState,
                        BackupDatabaseState,
                        BackupDatabaseFormItemSpec,
                        BackupDatabaseProvider
                    >
                        context={context}
                        component={component}
                        idx={index}
                    />
                </div>
            ));

    const handleSubmit = async () => {
        await context.backupDatabase();
    };

    const handleLoadAzureComponents = () => {
        if (!context || !state) return;

        const azureComponents = Object.keys(state.azureComponentStatuses);
        const azureComponentToLoad = azureComponents.find(
            (component) => state.azureComponentStatuses[component] === ApiStatus.NotStarted,
        );
        if (azureComponentToLoad) {
            context.loadAzureComponent(azureComponentToLoad);
        }
    };

    const getFileValidationMessage = (): string => {
        return state.backupFiles.length > 0 ? "" : locConstants.backupDatabase.chooseAtLeastOneFile;
    };

    const shouldDisableBackupButton = (): boolean => {
        const isUrlBackup = state.saveToUrl;

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
        const hasNoBackupFiles = !isUrlBackup && state.backupFiles.length === 0;
        const hasFileErrors = !isUrlBackup && fileErrors.length > 0;
        const isAzureNotReady =
            isUrlBackup && state.azureComponentStatuses["blobContainerId"] !== ApiStatus.Loaded;

        return (
            hasMissingRequiredValue ||
            hasFormErrors ||
            hasNoBackupFiles ||
            hasFileErrors ||
            isAzureNotReady
        );
    };

    return (
        <div className={classes.outerDiv}>
            <div className={classes.formDiv}>
                <div className={classes.header}>
                    <Image
                        style={{
                            padding: "10px",
                        }}
                        src={
                            context?.themeKind === ColorThemeKind.Light
                                ? databaseIconLight
                                : databaseIconDark
                        }
                        alt={`${locConstants.backupDatabase.backup} - ${context.state.databaseName}`}
                        height={60}
                        width={60}
                    />
                    <Text
                        size={500}
                        style={{
                            lineHeight: "60px",
                        }}
                        weight="medium">
                        {`${locConstants.backupDatabase.backup} - ${context.state.databaseName}`}
                    </Text>
                </div>
                {state.dialog?.type === "fileBrowser" && state.fileBrowserState && (
                    <FileBrowserDialog
                        ownerUri={state.ownerUri}
                        defaultFilePath={state.defaultFileBrowserExpandPath}
                        fileTree={state.fileBrowserState.fileTree}
                        showFoldersOnly={state.fileBrowserState.showFoldersOnly}
                        provider={context as FileBrowserProvider}
                        fileTypeOptions={state.fileFilterOptions}
                        closeDialog={() => context.toggleFileBrowserDialog(false, false)}
                    />
                )}
                {renderFormFields()}
                <div
                    className={formStyles.formComponentDiv}
                    style={{ padding: "10px", marginLeft: "8px" }}>
                    <Field
                        label={locConstants.backupDatabase.backupLocation}
                        orientation="horizontal">
                        <RadioGroup
                            onChange={(_, data) => {
                                const isSaveToUrl =
                                    data.value === locConstants.backupDatabase.saveToUrl;
                                context.setSaveLocation(isSaveToUrl);
                                if (isSaveToUrl) {
                                    // Start loading the first Azure component (Account) when switching to Save to URL
                                    context.loadAzureComponent("accountId");
                                }
                            }}
                            value={
                                context.state.saveToUrl
                                    ? locConstants.backupDatabase.saveToUrl
                                    : locConstants.backupDatabase.saveToDisk
                            }>
                            <Radio
                                value={locConstants.backupDatabase.saveToDisk}
                                label={
                                    <div className={classes.saveOption}>
                                        <Save20Regular style={{ marginRight: "8px" }} />
                                        {locConstants.backupDatabase.saveToDisk}
                                    </div>
                                }
                            />
                            <Radio
                                value={locConstants.backupDatabase.saveToUrl}
                                label={
                                    <div className={classes.saveOption}>
                                        <AzureIcon20 style={{ marginRight: "8px" }} />
                                        {locConstants.backupDatabase.saveToUrl}
                                    </div>
                                }
                            />
                        </RadioGroup>
                    </Field>
                </div>
                {state.saveToUrl ? (
                    state.azureComponentStatuses["accountId"] === ApiStatus.Loaded ? (
                        renderBackupSaveToUrlFields()
                    ) : (
                        <div className={classes.azureLoadingContainer}>
                            <img
                                className={classes.icon}
                                src={azureLogoColor()}
                                alt={locConstants.azure.loadingAzureAccounts}
                            />
                            <div>{locConstants.azure.loadingAzureAccounts}</div>
                            <Spinner size="large" style={{ marginTop: "10px" }} />
                        </div>
                    )
                ) : (
                    <div
                        className={formStyles.formComponentDiv}
                        style={{ padding: "10px", marginLeft: "8px" }}>
                        <Field
                            label={locConstants.backupDatabase.backupFiles}
                            validationMessage={getFileValidationMessage()}
                            required={true}
                            validationState={getFileValidationMessage() === "" ? "none" : "error"}
                            orientation="horizontal">
                            <div className={classes.fileDiv}>
                                <div className={classes.fileList}>
                                    {state.backupFiles.map((file, index) => (
                                        <BackupFileCard
                                            key={file.filePath}
                                            file={file}
                                            index={index}
                                            fileErrors={fileErrors}
                                            setFileErrors={setFileErrors}
                                        />
                                    ))}
                                </div>
                                <div className={classes.fileButtons}>
                                    <Button
                                        className={classes.button}
                                        type="submit"
                                        appearance="secondary"
                                        onClick={() => context.toggleFileBrowserDialog(true, true)}>
                                        {locConstants.backupDatabase.createNew}
                                    </Button>
                                    <Button
                                        className={classes.button}
                                        type="submit"
                                        appearance="secondary"
                                        onClick={() =>
                                            context.toggleFileBrowserDialog(false, true)
                                        }>
                                        {locConstants.backupDatabase.chooseExisting}
                                    </Button>
                                </div>
                            </div>
                        </Field>
                        {!state.formComponents["mediaSet"]?.isAdvancedOption && renderMediaFields()}
                    </div>
                )}
            </div>
            <AdvancedOptionsDrawer
                isAdvancedDrawerOpen={isAdvancedDrawerOpen}
                setIsAdvancedDrawerOpen={setIsAdvancedDrawerOpen}
            />
            <div className={classes.bottomDiv}>
                <hr style={{ background: tokens.colorNeutralBackground2 }} />
                <div className={classes.buttonDiv}>
                    <div className={classes.leftButtonDiv}>
                        <Button
                            className={classes.button}
                            appearance="secondary"
                            onClick={(_event) => {
                                setIsAdvancedDrawerOpen(!isAdvancedDrawerOpen);
                            }}>
                            {locConstants.backupDatabase.advanced}
                        </Button>
                    </div>
                    <div className={classes.rightButtonDiv}>
                        <Button
                            className={classes.button}
                            type="submit"
                            onClick={() => context.openBackupScript()}
                            appearance="primary">
                            {locConstants.backupDatabase.script}
                        </Button>
                        <Button
                            className={classes.button}
                            type="submit"
                            disabled={shouldDisableBackupButton()}
                            onClick={() => handleSubmit()}
                            appearance="primary">
                            {locConstants.backupDatabase.backup}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
