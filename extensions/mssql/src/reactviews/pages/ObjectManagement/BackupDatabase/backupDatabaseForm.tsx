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
} from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";
import { BackupDatabaseContext, BackupDatabaseContextProps } from "./backupDatabaseStateProvider";
import { BackupDatabaseViewModel } from "../../../../sharedInterfaces/backup";
import { FileBrowserDialog } from "../../../common/FileBrowserDialog";
import { FileBrowserProvider } from "../../../../sharedInterfaces/fileBrowser";
import { AdvancedOptionsDrawer } from "./backupAdvancedOptions";
import { FormField, useFormStyles } from "../../../common/forms/form.component";
import { AzureIcon20 } from "../../../common/icons/fluentIcons";
import { Save20Regular } from "@fluentui/react-icons";
import { url } from "../../../common/constants";
import { azureLogoColor } from "../../ConnectionDialog/azureBrowsePage";
import { BackupFileCard } from "./backupFileCard";
import { ApiStatus, ColorThemeKind } from "../../../../sharedInterfaces/webview";
import {
    ObjectManagementFormItemSpec,
    ObjectManagementFormState,
    ObjectManagementWebviewState,
} from "../../../../sharedInterfaces/objectManagement";

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
        overflow: "auto",
    },
    button: {
        height: "32px",
        width: "120px",
    },
    bottomDiv: {
        marginTop: "auto",
        paddingBottom: "50px",
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
        marginLeft: "0px",
    },
    fileButtons: {
        display: "flex",
        flexDirection: "row",
        gap: "8px",
        marginLeft: "10px",
    },
    advancedButtonDiv: {
        display: "flex",
        alignItems: "center",
        marginTop: "20px",
    },
    icon: {
        width: "75px",
        height: "75px",
        marginBottom: "10px",
    },
    azureLoadingContainer: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
    },
    formLoadingLabel: {
        display: "flex",
        alignItems: "center",
        marginTop: 0,
        marginBottom: 0,
    },
    fileList: {
        display: "flex",
        flexDirection: "column",
        padding: "10px",
        gap: "8px",
    },
    field: {
        width: "400px",
    },
});

const backupLightIcon = require("../../../../../media/backup_light.svg");
const backupDarkIcon = require("../../../../../media/backup_dark.svg");

export interface BackupFormProps {
    fileErrors: number[];
    setFileErrors: (errors: number[]) => void;
}

export const BackupDatabaseForm: React.FC<BackupFormProps> = ({ fileErrors, setFileErrors }) => {
    const classes = useStyles();
    const context = useContext(BackupDatabaseContext);
    const state = context?.state;

    if (!context || !state) {
        return null;
    }

    const backupViewModel = state.viewModel.model as BackupDatabaseViewModel;

    const formStyles = useFormStyles();
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);
    const formComponents = state.formComponents;

    const renderFormFields = () =>
        Object.values(formComponents)
            .filter((component) => !component.groupName)
            .map((component, index) => (
                <div
                    key={index}
                    className={formStyles.formComponentDiv}
                    style={
                        component.componentWidth
                            ? {
                                  width: component.componentWidth,
                                  maxWidth: component.componentWidth,
                                  whiteSpace: "normal", // allows wrapping
                                  overflowWrap: "break-word", // breaks long words if needed
                                  wordBreak: "break-word",
                              }
                            : {}
                    }>
                    <FormField<
                        ObjectManagementFormState,
                        ObjectManagementWebviewState,
                        ObjectManagementFormItemSpec,
                        BackupDatabaseContextProps
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
                const loadStatus = backupViewModel.azureComponentStatuses[component.propertyName];
                // Trigger loading only if not started or loaded
                if (loadStatus === ApiStatus.NotStarted) {
                    handleLoadAzureComponents();
                }

                return loadStatus === ApiStatus.Loaded || loadStatus === ApiStatus.Error ? (
                    <div
                        key={index}
                        className={formStyles.formComponentDiv}
                        style={
                            component.componentWidth
                                ? {
                                      width: component.componentWidth,
                                      maxWidth: component.componentWidth,
                                      whiteSpace: "normal", // allows wrapping
                                      overflowWrap: "break-word", // breaks long words if needed
                                      wordBreak: "break-word",
                                  }
                                : {}
                        }>
                        <FormField<
                            ObjectManagementFormState,
                            ObjectManagementWebviewState,
                            ObjectManagementFormItemSpec,
                            BackupDatabaseContextProps
                        >
                            context={context}
                            component={component}
                            idx={index}
                        />
                    </div>
                ) : (
                    <div style={{ marginLeft: "6px", marginBottom: "2px" }} key={index}>
                        <Field
                            key={index}
                            label={
                                <div className={classes.formLoadingLabel}>
                                    <Text>{component.label}</Text>
                                    <Spinner
                                        size="extra-tiny"
                                        style={{ transform: "scale(0.8)" }}
                                    />
                                </div>
                            }>
                            <Dropdown
                                size="small"
                                placeholder={locConstants.backupDatabase.loading}
                                style={{
                                    marginTop: 0,
                                    marginLeft: "5px",
                                    width: "630px",
                                }}
                            />
                        </Field>
                    </div>
                );
            });

    const renderMediaFields = () =>
        Object.values(formComponents)
            .filter((component) => component.groupName == locConstants.backupDatabase.media)
            .map((component, index) => (
                <div
                    key={index}
                    style={
                        component.componentWidth
                            ? {
                                  width: component.componentWidth,
                                  maxWidth: component.componentWidth,
                                  whiteSpace: "normal", // allows wrapping
                                  overflowWrap: "break-word", // breaks long words if needed
                                  wordBreak: "break-word",
                              }
                            : {}
                    }>
                    <FormField<
                        ObjectManagementFormState,
                        ObjectManagementWebviewState,
                        ObjectManagementFormItemSpec,
                        BackupDatabaseContextProps
                    >
                        context={context}
                        component={component}
                        idx={index}
                    />
                </div>
            ));
    const handleLoadAzureComponents = () => {
        if (!context || !backupViewModel) return;

        const azureComponents = Object.keys(backupViewModel.azureComponentStatuses);
        const azureComponentToLoad = azureComponents.find(
            (component) =>
                backupViewModel.azureComponentStatuses[component] === ApiStatus.NotStarted,
        );
        if (azureComponentToLoad) {
            context.loadAzureComponent(azureComponentToLoad);
        }
    };

    const getFileValidationMessage = (): string => {
        return backupViewModel.backupFiles.length > 0
            ? ""
            : locConstants.backupDatabase.chooseAtLeastOneFile;
    };

    return (
        <div className={classes.outerDiv}>
            <div>
                <div className={classes.header}>
                    <Image
                        style={{
                            padding: "10px",
                        }}
                        src={
                            context.themeKind === ColorThemeKind.Dark
                                ? backupDarkIcon
                                : backupLightIcon
                        }
                        alt={`${locConstants.backupDatabase.backup} - ${backupViewModel.databaseName}`}
                        height={60}
                        width={60}
                    />
                    <Text
                        size={500}
                        style={{
                            lineHeight: "60px",
                        }}
                        weight="medium">
                        {`${locConstants.backupDatabase.backup} - ${backupViewModel.databaseName}`}
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
                <div className={formStyles.formComponentDiv} style={{ marginLeft: "5px" }}>
                    <Field
                        label={locConstants.backupDatabase.backupLocation}
                        className={classes.field}
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
                                backupViewModel.saveToUrl
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
                {backupViewModel.saveToUrl ? (
                    backupViewModel.azureComponentStatuses["accountId"] === ApiStatus.Loaded ? (
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
                    <div className={formStyles.formComponentDiv} style={{ marginLeft: "5px" }}>
                        <Field
                            label={locConstants.backupDatabase.backupFiles}
                            validationMessage={getFileValidationMessage()}
                            required={true}
                            validationState={getFileValidationMessage() === "" ? "none" : "error"}
                            className={classes.field}
                            orientation="horizontal">
                            <div className={classes.fileDiv}>
                                <div className={classes.fileList}>
                                    {backupViewModel.backupFiles.map((file, index) => (
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
                <div className={classes.advancedButtonDiv}>
                    <Button
                        className={classes.button}
                        appearance="secondary"
                        onClick={(_event) => {
                            setIsAdvancedDrawerOpen(!isAdvancedDrawerOpen);
                        }}>
                        {locConstants.backupDatabase.advanced}
                    </Button>
                </div>
            </div>
        </div>
    );
};
