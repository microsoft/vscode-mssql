/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Checkbox, Text, makeStyles, tokens } from "@fluentui/react-components";

import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";

const extensionIcon = require("../../../../../images/extensionIcon.png");

const useStyles = makeStyles({
    root: {
        display: "flex",
        // The icon aligns to the top of the title block rather than the block's centre.
        alignItems: "flex-start",
        gap: "14px",
        paddingBottom: "18px",
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    icon: {
        width: "40px",
        height: "40px",
        flexShrink: 0,
    },
    titles: {
        display: "flex",
        flexDirection: "column",
        gap: "3px",
        minWidth: 0,
    },
    titleRow: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
    },
    title: {
        // <h1> carries a browser default margin that would dwarf the 3px gap above.
        marginTop: 0,
        marginBottom: 0,
        fontSize: "22px",
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: "28px",
    },
    version: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: "11px",
        color: tokens.colorNeutralForeground3,
        backgroundColor: tokens.colorNeutralBackground3,
        padding: "3px 8px",
        borderRadius: tokens.borderRadiusMedium,
    },
    subtitle: {
        color: tokens.colorNeutralForeground3,
    },
    spacer: {
        flexGrow: 1,
    },
});

export const OverviewHeader = () => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { setShowOnStartup } = useOverviewActions();
    const extensionVersion = useOverviewSelector((state) => state.extensionVersion);
    const showOnStartup = useOverviewSelector((state) => state.showOnStartup);

    return (
        <header className={classes.root}>
            <img className={classes.icon} src={extensionIcon} alt="" />
            <div className={classes.titles}>
                <div className={classes.titleRow}>
                    <Text as="h1" className={classes.title}>
                        {loc.title}
                    </Text>
                    {extensionVersion && (
                        <span className={classes.version}>{loc.version(extensionVersion)}</span>
                    )}
                </div>
                <Text className={classes.subtitle}>{loc.subtitle}</Text>
            </div>
            <div className={classes.spacer} />
            <Checkbox
                checked={showOnStartup}
                label={loc.showOnStartup}
                title={loc.showOnStartupTooltip}
                onChange={(_event, data) => setShowOnStartup(Boolean(data.checked))}
            />
        </header>
    );
};
