/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import {
    Button,
    Card,
    Field,
    Input,
    makeStyles,
    Radio,
    RadioGroup,
    Spinner,
    tokens,
} from "@fluentui/react-components";
import { locConstants } from "../../common/locConstants";
import { BackupDatabaseContext } from "./backupDatabaseStateProvider";
import {
    BackupDatabaseFormItemSpec,
    BackupDatabaseFormState,
    BackupDatabaseProvider,
    BackupDatabaseState,
} from "../../../sharedInterfaces/objectManagement";
import { FileBrowserDialog } from "../../common/FileBrowserDialog";
import { FileBrowserProvider } from "../../../sharedInterfaces/fileBrowser";
import { Image, Text } from "@fluentui/react-components";
import { ApiStatus, ColorThemeKind } from "../../../sharedInterfaces/webview";
import { AdvancedOptionsDrawer } from "./backupAdvancedOptions";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { AzureIcon20 } from "../../common/icons/fluentIcons";
import {
    Dismiss20Regular,
    DocumentAdd24Regular,
    DocumentEdit24Regular,
    Save20Regular,
} from "@fluentui/react-icons";
import { url } from "../../../constants/constants";
import { azureLogoColor } from "../ConnectionDialog/azureBrowsePage";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        marginLeft: "5px",
        marginRight: "5px",
        padding: "8px",
        width: "500px",
        whiteSpace: "nowrap",
        minWidth: "800px",
        height: "80vh",
    },
    button: {
        height: "32px",
        width: "160px",
    },
    advancedOptionsDiv: {
        marginLeft: "24px",
    },
    bottomDiv: {
        bottom: 0,
        paddingBottom: "50px",
    },
    formDiv: {
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
    },
    cardDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "10px",
    },
    cardHeader: {
        display: "flex",
        flexDirection: "row",
        gap: "4px",
        alignItems: "center",
        marginBottom: "10px",
    },
    headerActions: {
        display: "flex",
        gap: "4px",
        marginLeft: "auto",
    },
    cardField: {
        display: "grid",
        gridTemplateColumns: "125px 1fr",
        padding: "10px",
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
});

const databaseIconLight = require("../../../../media/database_light.svg");
const databaseIconDark = require("../../../../media/database_dark.svg");

export const BackupDatabaseForm: React.FC = () => {
    const classes = useStyles();
    const formStyles = useFormStyles();
    const context = useContext(BackupDatabaseContext);

    const state = context?.state;

    if (!context || !state) {
        return;
    }

    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);

    const { formComponents } = state;

    const renderFormFields = () =>
        Object.values(formComponents)
            .filter((component) => !component.groupName)
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

    const renderBackupFiles = () =>
        state.backupFiles.map((file, index) => {
            return (
                <Card className={classes.cardDiv} key={file.filePath}>
                    <div className={classes.cardHeader}>
                        {file.isExisting ? <DocumentEdit24Regular /> : <DocumentAdd24Regular />}
                        <Text size={400} style={{ marginLeft: "4px" }}>
                            {file.isExisting
                                ? locConstants.backupDatabase.existingFile
                                : locConstants.backupDatabase.newFile}
                        </Text>
                        <div className={classes.headerActions}>
                            <Button
                                appearance="subtle"
                                icon={<Dismiss20Regular />}
                                title={locConstants.backupDatabase.removeFile}
                                aria-label={locConstants.backupDatabase.removeFile}
                                onClick={() => handleRemoveFile(file.filePath)}
                            />
                        </div>
                    </div>
                    <div className={classes.cardField}>
                        <Text>{locConstants.backupDatabase.folderPath}</Text>
                        {file.isExisting ? (
                            <Text>{getFolderNameFromPath(file.filePath)}</Text>
                        ) : (
                            <Field required={true}>
                                <Input
                                    value={getFolderNameFromPath(file.filePath)}
                                    onChange={(e) => {
                                        context.handleFileChange(index, e.target.value, true);
                                    }}
                                />
                            </Field>
                        )}
                    </div>
                    <div className={classes.cardField}>
                        <Text>{locConstants.backupDatabase.fileName}</Text>
                        {file.isExisting ? (
                            <Text>{getFileNameFromPath(file.filePath)}</Text>
                        ) : (
                            <Field
                                validationMessage={
                                    isFileNameValid(file.filePath)
                                        ? ""
                                        : locConstants.backupDatabase.chooseUniqueFile
                                }
                                required={true}
                                validationState={isFileNameValid(file.filePath) ? "none" : "error"}>
                                <Input
                                    value={getFileNameFromPath(file.filePath)}
                                    onChange={(e) => {
                                        context.handleFileChange(index, e.target.value, false);
                                    }}
                                />
                            </Field>
                        )}
                    </div>
                </Card>
            );
        });

    const handleSubmit = async () => {
        await context.backupDatabase();
    };

    const handleRemoveFile = async (filePath: string) => {
        await context.removeBackupFile(filePath);
    };

    const getFileValidationMessage = () => {
        if (state.backupFiles.length === 0) {
            return locConstants.backupDatabase.chooseAtLeastOneFile;
        }
        return "";
    };

    const isFileNameValid = (filePath: string) => {
        const files = state.backupFiles.filter((file) => file.filePath === filePath);
        return files.length <= 1;
    };

    const getFolderNameFromPath = (filePath: string) => {
        const lastSlashIndex = filePath.lastIndexOf("/");
        return filePath.substring(0, lastSlashIndex);
    };

    const getFileNameFromPath = (filePath: string) => {
        const lastSlashIndex = filePath.lastIndexOf("/");
        return filePath.substring(lastSlashIndex + 1);
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
                        alt={`${locConstants.backupDatabase.backup} - ${context.state.databaseNode.label}`}
                        height={60}
                        width={60}
                    />
                    <Text
                        size={500}
                        style={{
                            lineHeight: "60px",
                        }}
                        weight="medium">
                        {`${locConstants.backupDatabase.backup} - ${context.state.databaseNode.label}`}
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
                <div className={formStyles.formComponentDiv}>
                    <Field
                        label={locConstants.backupDatabase.backupLocation}
                        orientation="horizontal">
                        <RadioGroup
                            onChange={(_, data) => {
                                const isSaveToUrl =
                                    data.value === locConstants.backupDatabase.saveToUrl;
                                context.setSaveLocation(isSaveToUrl);
                                if (isSaveToUrl) {
                                    context.setAzureContext();
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
                    state.azureContextStatus === ApiStatus.Loaded ? (
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
                    <div className={formStyles.formComponentDiv}>
                        <Field
                            label={locConstants.backupDatabase.backupFiles}
                            validationMessage={getFileValidationMessage()}
                            required={true}
                            validationState={getFileValidationMessage() === "" ? "none" : "error"}
                            orientation="horizontal">
                            <div className={classes.fileDiv}>
                                {renderBackupFiles()}
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
                            onClick={() => handleSubmit()}
                            appearance="primary">
                            {locConstants.backupDatabase.backup}
                        </Button>
                        <Button
                            className={classes.button}
                            type="submit"
                            onClick={() => context.openBackupScript()}
                            appearance="primary">
                            {locConstants.backupDatabase.script}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
