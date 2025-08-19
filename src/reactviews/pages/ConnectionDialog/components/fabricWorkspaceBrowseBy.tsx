/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from "react";
import { Text, ToggleButton, makeStyles, tokens } from "@fluentui/react-components";
import { StarRegular, HistoryRegular, PersonCircleRegular } from "@fluentui/react-icons";
import { locConstants as Loc } from "../../../common/locConstants";

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        width: "fit-content",
        marginBottom: "16px",
    },
    label: {
        fontSize: "11px",
        fontWeight: "500",
        color: tokens.colorNeutralForeground2,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        marginLeft: "2px",
    },
    buttonGroup: {
        display: "flex",
        flexDirection: "row",
        gap: "0px", // No gap to create joined buttons
        width: "fit-content",
    },
    button: {
        minHeight: "28px",
        padding: "5px 14px",
        fontSize: "13px",
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
        "&:hover": {
            backgroundColor: tokens.colorNeutralBackground1Hover,
        },
        "&:first-child": {
            borderTopLeftRadius: "3px",
            borderBottomLeftRadius: "3px",
            borderRight: "none",
        },
        "&:last-child": {
            borderTopRightRadius: "3px",
            borderBottomRightRadius: "3px",
            borderLeft: "none",
        },
        "&:not(:first-child):not(:last-child)": {
            borderRadius: "0px",
            borderLeft: "none",
            borderRight: "none",
        },
    },
    activeButton: {
        backgroundColor: tokens.colorBrandBackground,
        color: tokens.colorNeutralForegroundOnBrand,
        "&:hover": {
            backgroundColor: tokens.colorBrandBackgroundHover,
        },
    },
});

type BrowseByOption = "myData" | "recent" | "favorites" | "none";

const fabricWorkspaceBrowseBy = () => {
    const classes = useStyles();
    const [selectedOption, setSelectedOption] = useState<BrowseByOption>("myData");

    const handleButtonClick = (option: BrowseByOption) => {
        if (selectedOption === option) {
            // If clicking the same button, uncheck it
            setSelectedOption("none");
        } else {
            // Otherwise, select the clicked button
            setSelectedOption(option);
        }
    };

    return (
        <div className={classes.container}>
            <Text className={classes.label}>{Loc.connectionDialog.browseBy}</Text>
            <div className={classes.buttonGroup}>
                <ToggleButton
                    appearance="transparent"
                    icon={<PersonCircleRegular />}
                    onClick={() => handleButtonClick("myData")}
                    checked={selectedOption === "myData"}>
                    {Loc.connectionDialog.myData}
                </ToggleButton>
                <ToggleButton
                    appearance="transparent"
                    icon={<HistoryRegular />}
                    onClick={() => handleButtonClick("recent")}
                    checked={selectedOption === "recent"}>
                    {Loc.connectionDialog.recent}
                </ToggleButton>
                <ToggleButton
                    appearance="transparent"
                    icon={<StarRegular />}
                    onClick={() => handleButtonClick("favorites")}
                    checked={selectedOption === "favorites"}>
                    {Loc.connectionDialog.favorites}
                </ToggleButton>
            </div>
        </div>
    );
};

export default fabricWorkspaceBrowseBy;
