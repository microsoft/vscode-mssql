/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Checkbox, Text, makeStyles, tokens } from "@fluentui/react-components";

import { ActionRow } from "./actionRow";
import { VersionBadge } from "../../../common/versionBadge";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";

const extensionIcon = require("../../../../../images/extensionIcon.png");

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "18px",
        paddingBottom: "18px",
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    identity: {
        display: "flex",
        alignItems: "flex-start",
        gap: "14px",
        flexWrap: "wrap",
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
        marginTop: 0,
        marginBottom: 0,
        fontSize: "22px",
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: "28px",
    },
    subtitle: {
        color: tokens.colorNeutralForeground3,
    },
    publisher: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
    preference: {
        marginLeft: "auto",
        alignSelf: "center",
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
});

export const OverviewHeader = () => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const extensionVersion = useOverviewSelector((state) => state.extensionVersion);
    const showChangelogOnUpdate = useOverviewSelector((state) => state.showChangelogOnUpdate);
    const { setShowChangelogOnUpdate } = useOverviewActions();

    return (
        <header className={classes.root}>
            <div className={classes.identity}>
                <img className={classes.icon} src={extensionIcon} alt="" />
                <div className={classes.titles}>
                    <div className={classes.titleRow}>
                        <Text as="h1" className={classes.title}>
                            {loc.title}
                        </Text>
                        {extensionVersion && <VersionBadge version={extensionVersion} />}
                    </div>
                    <Text className={classes.subtitle}>{loc.subtitle}</Text>
                    <Text className={classes.publisher}>{loc.extensionPublisher}</Text>
                </div>
                <Checkbox
                    className={classes.preference}
                    checked={showChangelogOnUpdate}
                    label={loc.showReleaseNotesAfterUpdates}
                    onChange={(_event, data) => setShowChangelogOnUpdate(data.checked === true)}
                />
            </div>
            <ActionRow />
        </header>
    );
};
