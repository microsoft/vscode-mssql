/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import {
    Button,
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
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { locConstants } from "../../common/locConstants";
import { FlatFileContext } from "./flatFileStateProvider";
import { FlatFileHeader } from "./flatFileHeader";
import { FlatFileColumnSettings } from "./flatFileColumnSettings";

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
    button: {
        height: "32px",
        width: "160px",
        margin: "20px",
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

    operationText: {
        whiteSpace: "wrap",
        margin: "20px",
    },
});

export const FlatFilePreviewTable = () => {
    const classes = useStyles();
    const context = useContext(FlatFileContext);
    const state = context?.state;

    if (!context || !state) return;

    const loadState = state.tablePreviewStatus;
    const [showNext, setShowNext] = useState<boolean>(false);

    const renderMainContent = () => {
        switch (loadState) {
            case ApiStatus.Loading:
                return (
                    <div className={classes.spinnerDiv}>
                        <Spinner
                            label={locConstants.flatFileImport.loadingTablePreview}
                            labelPosition="below"
                        />
                    </div>
                );
            case ApiStatus.Loaded:
                return showNext ? (
                    <FlatFileColumnSettings />
                ) : (
                    <div>
                        <FlatFileHeader
                            headerText={locConstants.flatFileImport.importFile}
                            stepText={locConstants.flatFileImport.stepTwo}
                        />

                        <Text className={classes.operationText}>
                            {locConstants.flatFileImport.operationPreviewText}
                        </Text>

                        <div className={classes.tableDiv}>
                            <Table>
                                <TableHeader className={classes.tableHeader}>
                                    <TableRow>
                                        {state.tablePreview?.columnInfo.map((column) => (
                                            <TableHeaderCell
                                                key={column.name}
                                                className={classes.tableHeaderCell}>
                                                <Text className={classes.columnText}>
                                                    {column.name}
                                                </Text>
                                            </TableHeaderCell>
                                        ))}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {state.tablePreview?.dataPreview.map((row, rowIndex) => (
                                        <TableRow key={rowIndex}>
                                            {row.map((cell, cellIndex) => (
                                                <TableCell
                                                    key={cellIndex}
                                                    className={classes.tableBodyCell}>
                                                    <Text className={classes.cellText}>{cell}</Text>
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>

                        <div className={classes.bottomDiv}>
                            <hr style={{ background: tokens.colorNeutralBackground2 }} />
                            <Button
                                className={classes.button}
                                type="submit"
                                onClick={() => setShowNext(true)}
                                appearance="primary">
                                {locConstants.common.next}
                            </Button>
                        </div>
                    </div>
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
