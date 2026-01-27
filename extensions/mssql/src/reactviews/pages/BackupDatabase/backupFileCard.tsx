/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Button, Card, Field, Input, Text, makeStyles } from "@fluentui/react-components";
import { locConstants } from "../../common/locConstants";
import { BackupDatabaseContext } from "./backupDatabaseStateProvider";
import {
    Dismiss20Regular,
    DocumentAdd24Regular,
    DocumentEdit24Regular,
} from "@fluentui/react-icons";
import { BackupFile } from "../../../sharedInterfaces/backup";

const useStyles = makeStyles({
    cardDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "10px",
        width: "425px",
        height: "180px",
    },
    cardContent: {
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
        gridTemplateColumns: "150px 1fr",
        padding: "10px",
    },
});

export const BackupFileCard = ({
    file,
    index,
    fileErrors,
    setFileErrors,
}: {
    file: BackupFile;
    index: number;
    fileErrors: number[];
    setFileErrors: (errors: number[]) => void;
}) => {
    const classes = useStyles();
    const context = useContext(BackupDatabaseContext);

    const state = context?.state;

    if (!context || !state) {
        return;
    }

    const getFileNameErrorMessage = (filePath: string) => {
        const fileName = getFileNameFromPath(filePath);
        if (fileName.trim() === "") return locConstants.backupDatabase.fileNameRequired;
        const files = state.backupFiles.filter((file) => file.filePath === filePath);
        return files.length <= 1 ? "" : locConstants.backupDatabase.chooseUniqueFile;
    };

    const getFolderNameFromPath = (filePath: string) => {
        const lastSlashIndex = filePath.lastIndexOf("/");
        return filePath.substring(0, lastSlashIndex);
    };

    const getFileNameFromPath = (filePath: string) => {
        const lastSlashIndex = filePath.lastIndexOf("/");
        return filePath.substring(lastSlashIndex + 1);
    };

    const handleRemoveFile = async (filePath: string) => {
        await context.removeBackupFile(filePath);
    };

    return (
        <Card className={classes.cardDiv} key={file.filePath}>
            <div className={classes.cardContent}>
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
                        <Text style={{ paddingBottom: "15px" }}>
                            {getFolderNameFromPath(file.filePath)}
                        </Text>
                    ) : (
                        <Field
                            required
                            validationState={
                                getFolderNameFromPath(file.filePath).trim() === ""
                                    ? "error"
                                    : "none"
                            }
                            validationMessage={
                                getFolderNameFromPath(file.filePath).trim() === ""
                                    ? locConstants.backupDatabase.folderPathRequired
                                    : ""
                            }>
                            <Input
                                value={getFolderNameFromPath(file.filePath)}
                                onChange={(e) => {
                                    context.handleFileChange(index, e.target.value, true);
                                    if (e.target.value.trim() !== "") {
                                        setFileErrors(
                                            fileErrors.filter((fileIndex) => fileIndex !== index),
                                        );
                                    } else {
                                        if (!fileErrors.includes(index)) {
                                            setFileErrors([...fileErrors, index]);
                                        }
                                    }
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
                            validationMessage={getFileNameErrorMessage(file.filePath)}
                            required
                            validationState={
                                getFileNameErrorMessage(file.filePath) === "" ? "none" : "error"
                            }>
                            <Input
                                value={getFileNameFromPath(file.filePath)}
                                onChange={(e) => {
                                    const newPath = `${getFolderNameFromPath(
                                        state.backupFiles[index].filePath,
                                    )}/${e.target.value}`;

                                    context.handleFileChange(index, e.target.value, false);

                                    if (getFileNameErrorMessage(newPath) === "") {
                                        setFileErrors(
                                            fileErrors.filter((fileIndex) => fileIndex !== index),
                                        );
                                    } else {
                                        if (!fileErrors.includes(index)) {
                                            setFileErrors([...fileErrors, index]);
                                        }
                                    }
                                }}
                            />
                        </Field>
                    )}
                </div>
            </div>
        </Card>
    );
};
