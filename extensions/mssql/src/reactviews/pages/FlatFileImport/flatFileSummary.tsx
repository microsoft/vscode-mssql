/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import {
    Button,
    Link,
    makeStyles,
    Spinner,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    tokens,
} from "@fluentui/react-components";
import { locConstants } from "../../common/locConstants";
import { FlatFileContext } from "./flatFileStateProvider";
import { FlatFileHeader } from "./flatFileHeader";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { Checkmark20Regular, Dismiss20Regular } from "@fluentui/react-icons";
import { FlatFileColumnSettings } from "./flatFileColumnSettings";

const useStyles = makeStyles({
    outerDiv: {
        height: "100%",
        width: "100%",
        position: "relative",
        overflowY: "auto",
        overflowX: "unset",
    },
    button: {
        height: "32px",
        width: "120px",
        margin: "5px",
    },
    bottomDiv: {
        bottom: 0,
        paddingBottom: "50px",
    },

    tableDiv: {
        overflow: "auto",
        maxHeight: "60vh",
        tableLayout: "fixed",
        position: "relative",
        margin: "20px",
    },

    tableHeader: {
        position: "sticky",
        top: 0,
        zIndex: 1,
        opacity: 1,
    },

    tableHeaderCell: {
        overflow: "hidden",
        backgroundColor: tokens.colorNeutralBackground6,
        opacity: 1,
    },

    tableBodyCell: {
        overflow: "hidden",
    },

    cellText: {
        fontWeight: 400,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },

    columnText: {
        fontWeight: 600,
        overflow: "hidden",
        textOverflow: "ellipsis",
    },

    subheaderText: {
        fontWeight: 600,
        fontSize: "16px",
        whiteSpace: "wrap",
        margin: "20px",
    },

    statusDiv: {
        margin: "20px",
    },

    errorDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },

    statusItems: {
        display: "flex",
        flexDirection: "row",
        gap: "8px",
    },
    linkDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        marginLeft: "28px",
        marginTop: "8px",
    },
});

export const FlatFileSummary = () => {
    const classes = useStyles();
    const context = useContext(FlatFileContext);
    const state = context?.state;

    if (!context || !state) return;

    const [showFullErrorMessage, setShowFullErrorMessage] = useState(false);
    const [showPrevious, setShowPrevious] = useState(false);

    const columns = [locConstants.flatFileImport.objectType, locConstants.flatFileImport.name];
    const data = [
        [locConstants.flatFileImport.serverName, state.serverName],
        [locConstants.flatFileImport.databaseName, state.formState.databaseName],
        [locConstants.flatFileImport.tableName, state.formState.tableName],
        [locConstants.flatFileImport.tableSchema, state.formState.tableSchema],
        [locConstants.flatFileImport.fileToBeImported, state.formState.flatFilePath],
    ];

    useEffect(() => {
        if (state.importDataStatus === ApiStatus.NotStarted) {
            context.importData();
        }
    }, []);

    return showPrevious ? (
        <FlatFileColumnSettings />
    ) : (
        <div className={classes.outerDiv}>
            <FlatFileHeader
                headerText={locConstants.flatFileImport.importFile}
                stepText={locConstants.flatFileImport.stepFour}
            />

            <Text className={classes.subheaderText}>
                {locConstants.flatFileImport.importInformation}
            </Text>

            <div className={classes.tableDiv}>
                <Table>
                    <TableHeader className={classes.tableHeader}>
                        <TableRow>
                            {columns.map((column, index) => (
                                <TableHeaderCell key={index} className={classes.tableHeaderCell}>
                                    <Text className={classes.columnText}>{column}</Text>
                                </TableHeaderCell>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.map((row, index) => (
                            <TableRow key={index}>
                                {row.map((cell, cellIndex) => (
                                    <TableCell key={cellIndex} className={classes.tableBodyCell}>
                                        <Text className={classes.cellText}>{cell}</Text>
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            <Text className={classes.subheaderText}>
                {locConstants.flatFileImport.importStatus}
            </Text>

            <div className={classes.statusDiv}>
                {(() => {
                    switch (state.importDataStatus) {
                        case ApiStatus.NotStarted:
                        case ApiStatus.Loading:
                            return <Spinner label={locConstants.flatFileImport.importingData} />;

                        case ApiStatus.Loaded:
                            return (
                                <div className={classes.statusItems}>
                                    <Checkmark20Regular
                                        style={{ color: tokens.colorStatusSuccessBackground3 }}
                                    />
                                    <Text>{locConstants.flatFileImport.importSuccessful}</Text>
                                </div>
                            );

                        case ApiStatus.Error:
                            return (
                                <div className={classes.errorDiv}>
                                    <div className={classes.statusItems}>
                                        <Dismiss20Regular
                                            style={{ color: tokens.colorStatusDangerBackground3 }}
                                        />
                                        <Text>{state.errorMessage}</Text>
                                    </div>
                                    <div className={classes.linkDiv}>
                                        <Link
                                            onClick={() =>
                                                setShowFullErrorMessage(!showFullErrorMessage)
                                            }>
                                            {showFullErrorMessage
                                                ? locConstants.flatFileImport.hideFullErrorMessage
                                                : locConstants.flatFileImport.showFullErrorMessage}
                                        </Link>
                                        {showFullErrorMessage && (
                                            <Text>{state.fullErrorMessage}</Text>
                                        )}
                                    </div>
                                </div>
                            );

                        default:
                            return null;
                    }
                })()}
            </div>

            <div className={classes.bottomDiv}>
                <Button
                    className={classes.button}
                    type="submit"
                    onClick={() => setShowPrevious(true)}
                    appearance="secondary">
                    {locConstants.common.previous}
                </Button>
                <Button
                    className={classes.button}
                    type="submit"
                    onClick={() => context.dispose()}
                    appearance={
                        state.importDataStatus === ApiStatus.Loaded ? "primary" : "secondary"
                    }>
                    {state.importDataStatus === ApiStatus.Loaded
                        ? locConstants.common.finish
                        : locConstants.common.cancel}
                </Button>
            </div>
        </div>
    );
};
