/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { FlatFileContext } from "./flatFileStateProvider";
import { DocumentArrowDown20Regular } from "@fluentui/react-icons";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "row",
        gap: "20px",
        alignItems: "center",
        justifyContent: "flex-start",
        margin: "25px",
        minWidth: "750px",
        minHeight: "fit-content",
    },
    textDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
    },
    titleDiv: {
        fontWeight: 500,
        fontSize: "24px",
        display: "flex",
        alignItems: "center",
    },
    subtitleDiv: {
        fontWeight: 350,
        fontSize: "14px",
        display: "flex",
        alignItems: "center",
        color: tokens.colorNeutralForeground3,
    },
    icon: {
        width: "65px",
        height: "65px",
    },
});

interface HeaderProps {
    headerText: string;
    stepText: string;
}

export const FlatFileHeader: React.FC<HeaderProps> = ({ headerText, stepText }) => {
    const classes = useStyles();
    const context = useContext(FlatFileContext);
    const state = context?.state;

    if (!context || !state) return;

    return (
        <div className={classes.outerDiv}>
            <DocumentArrowDown20Regular className={classes.icon} />
            <div className={classes.textDiv}>
                <div className={classes.titleDiv}>{headerText}</div>
                <div className={classes.subtitleDiv}>{stepText}</div>
            </div>
        </div>
    );
};
