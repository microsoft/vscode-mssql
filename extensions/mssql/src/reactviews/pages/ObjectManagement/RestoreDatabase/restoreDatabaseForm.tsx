/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import {
    RestoreDatabaseContext,
    RestoreDatabaseContextProps,
} from "./restoreDatabaseStateProvider";
import { FormField, useFormStyles } from "../../../common/forms/form.component";
import {
    RestoreDatabaseFormState,
    RestoreDatabaseViewModel,
    RestorePlanTableType,
    RestoreType,
} from "../../../../sharedInterfaces/restore";
import {
    ObjectManagementFormItemSpec,
    ObjectManagementWebviewState,
} from "../../../../sharedInterfaces/objectManagement";
import { locConstants } from "../../../common/locConstants";
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
import { ApiStatus, ColorThemeKind } from "../../../../sharedInterfaces/webview";
import { AzureIcon20 } from "../../../common/icons/fluentIcons";
import { Database20Regular, DocumentDatabase20Regular } from "@fluentui/react-icons";
import { azureLogoColor } from "../../ConnectionDialog/azureBrowsePage";
import { BackupFileCard } from "../BackupDatabase/backupFileCard";
import { BackupFormProps } from "../BackupDatabase/backupDatabaseForm";
import { FileBrowserProvider } from "../../../../sharedInterfaces/fileBrowser";
import { FileBrowserDialog } from "../../../common/FileBrowserDialog";
import { AdvancedOptionsDrawer } from "./restoreAdvancedOptions";
import { useRestoreDatabaseSelector } from "./restoreDatabaseSelector";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { RestorePlanTableContainer } from "./restoreTable";

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

const restoreLightIcon = require("../../../../../media/restore_light.svg");
const restoreDarkIcon = require("../../../../../media/restore_dark.svg");

export const RestoreDatabaseForm: React.FC<BackupFormProps> = ({ fileErrors, setFileErrors }) => {
    const classes = useStyles();
    const context = useContext(RestoreDatabaseContext);

    if (!context) {
        return null;
    }

    const formComponents = useRestoreDatabaseSelector((s) => s.formComponents);
    const formState = useRestoreDatabaseSelector((s) => s.formState);
    const dialog = useRestoreDatabaseSelector((s) => s.dialog);
    const fileBrowserState = useRestoreDatabaseSelector((s) => s.fileBrowserState);
    const ownerUri = useRestoreDatabaseSelector((s) => s.ownerUri);
    const defaultFileBrowserExpandPath = useRestoreDatabaseSelector(
        (s) => s.defaultFileBrowserExpandPath,
    );
    const fileFilterOptions = useRestoreDatabaseSelector((s) => s.fileFilterOptions);
    const azureComponentStatuses = useRestoreDatabaseSelector(
        (s) => (s.viewModel.model as RestoreDatabaseViewModel).azureComponentStatuses,
    );
    const backupFiles = useRestoreDatabaseSelector(
        (s) => (s.viewModel.model as RestoreDatabaseViewModel).backupFiles,
    );
    const serverName = useRestoreDatabaseSelector(
        (s) => (s.viewModel.model as RestoreDatabaseViewModel).serverName,
    );

    const { themeKind } = useVscodeWebview();

    const [restoreType, setRestoreType] = useState<RestoreType>(
        useRestoreDatabaseSelector(
            (s) => (s.viewModel.model as RestoreDatabaseViewModel).restoreType,
        ),
    );
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState<boolean>(false);

    const formStyles = useFormStyles();

    const handleLoadAzureComponents = () => {
        const azureComponents = Object.keys(azureComponentStatuses);
        const azureComponentToLoad = azureComponents.find(
            (component) => azureComponentStatuses[component] === ApiStatus.NotStarted,
        );
        if (azureComponentToLoad) {
            context.loadAzureComponent(azureComponentToLoad);
        }
    };

    const renderFormFields = (groupName?: string) =>
        Object.values(formComponents)
            .filter(
                (component) =>
                    component.groupName === groupName || (!groupName && !component.groupName),
            )
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
                        RestoreDatabaseFormState,
                        ObjectManagementWebviewState<RestoreDatabaseFormState>,
                        ObjectManagementFormItemSpec<RestoreDatabaseFormState>,
                        RestoreDatabaseContextProps
                    >
                        context={context}
                        formState={formState}
                        component={component}
                        idx={index}
                    />
                </div>
            ));

    const renderUrlFields = () =>
        Object.values(formComponents)
            .filter((component) => component.groupName === RestoreType.Url)
            .map((component, index) => {
                const loadStatus = azureComponentStatuses[component.propertyName];
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
                            RestoreDatabaseFormState,
                            ObjectManagementWebviewState<RestoreDatabaseFormState>,
                            ObjectManagementFormItemSpec<RestoreDatabaseFormState>,
                            RestoreDatabaseContextProps
                        >
                            context={context}
                            formState={formState}
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

    const getFileValidationMessage = (): string => {
        return backupFiles.length > 0 ? "" : locConstants.backupDatabase.chooseAtLeastOneFile;
    };

    return (
        <div>
            <div className={classes.outerDiv}>
                <div className={classes.header}>
                    <Image
                        style={{
                            padding: "10px",
                        }}
                        src={themeKind === ColorThemeKind.Dark ? restoreDarkIcon : restoreLightIcon}
                        alt={`${locConstants.restoreDatabase.restoreDatabase} - ${serverName}`}
                        height={60}
                        width={60}
                    />
                    <Text
                        size={500}
                        style={{
                            lineHeight: "60px",
                        }}
                        weight="medium">
                        {`${locConstants.restoreDatabase.restore} - ${serverName}`}
                    </Text>
                </div>
                {dialog?.type === "fileBrowser" && fileBrowserState && (
                    <FileBrowserDialog
                        ownerUri={ownerUri}
                        defaultFilePath={defaultFileBrowserExpandPath}
                        fileTree={fileBrowserState.fileTree}
                        showFoldersOnly={fileBrowserState.showFoldersOnly}
                        provider={context as FileBrowserProvider}
                        fileTypeOptions={fileFilterOptions}
                        closeDialog={() => context.toggleFileBrowserDialog(false, false)}
                    />
                )}
                <div className={formStyles.formComponentDiv} style={{ marginLeft: "5px" }}>
                    <Field
                        label={locConstants.backupDatabase.backupLocation}
                        className={classes.field}
                        orientation="horizontal">
                        <RadioGroup
                            onChange={(_, data) => {
                                const selectedRestoreType = data.value as RestoreType;
                                context.setRestoreType(selectedRestoreType);
                                setRestoreType(selectedRestoreType);
                                if (selectedRestoreType === RestoreType.Url) {
                                    context.loadAzureComponent("accountId");
                                }
                            }}
                            value={restoreType}>
                            <Radio
                                value={RestoreType.Database}
                                label={
                                    <div className={classes.saveOption}>
                                        <Database20Regular style={{ marginRight: "8px" }} />
                                        {locConstants.restoreDatabase.database}
                                    </div>
                                }
                            />
                            <Radio
                                value={RestoreType.BackupFile}
                                label={
                                    <div className={classes.saveOption}>
                                        <DocumentDatabase20Regular style={{ marginRight: "8px" }} />
                                        {locConstants.restoreDatabase.backupFile}
                                    </div>
                                }
                            />
                            <Radio
                                value={RestoreType.Url}
                                label={
                                    <div className={classes.saveOption}>
                                        <AzureIcon20 style={{ marginRight: "8px" }} />
                                        {locConstants.restoreDatabase.url}
                                    </div>
                                }
                            />
                        </RadioGroup>
                    </Field>
                </div>
                {restoreType === RestoreType.Url ? (
                    azureComponentStatuses["accountId"] === ApiStatus.Loaded ? (
                        renderUrlFields()
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
                ) : restoreType === RestoreType.BackupFile ? (
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
                                    {backupFiles.map((file, index) => (
                                        <div key={file.filePath}>
                                            <Field
                                                validationMessage={file.errorMessage}
                                                validationState={
                                                    file.errorMessage ? "none" : "error"
                                                }>
                                                <BackupFileCard
                                                    backupFiles={backupFiles}
                                                    file={file}
                                                    index={index}
                                                    fileErrors={fileErrors}
                                                    setFileErrors={setFileErrors}
                                                    removeBackupFile={context.removeBackupFile}
                                                />
                                            </Field>
                                        </div>
                                    ))}
                                </div>
                                <div className={classes.fileButtons}>
                                    <Button
                                        className={classes.button}
                                        type="submit"
                                        appearance="secondary"
                                        onClick={() => {
                                            context.toggleFileBrowserDialog(false, true);
                                        }}>
                                        {locConstants.restoreDatabase.browseFiles}
                                    </Button>
                                </div>
                            </div>
                        </Field>
                    </div>
                ) : (
                    renderFormFields(RestoreType.Database)
                )}
                {renderFormFields()}
                <RestorePlanTableContainer restoreTableType={RestorePlanTableType.BackupSets} />
                <AdvancedOptionsDrawer
                    isAdvancedDrawerOpen={isAdvancedDrawerOpen}
                    setIsAdvancedDrawerOpen={setIsAdvancedDrawerOpen}
                />
                <div className={classes.bottomDiv}>
                    <div style={{ marginLeft: "10px" }}>
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
        </div>
    );
};
