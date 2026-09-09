/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Play20Filled } from "@fluentui/react-icons";

import { SectionHeading } from "./sectionHeading";
import { getVideoCards, overviewLinks } from "../overviewContent";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        paddingBottom: tokens.spacingVerticalXL,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: tokens.spacingHorizontalM,
    },
    card: {
        display: "flex",
        flexDirection: "column",
        textAlign: "left",
        padding: 0,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground1,
        color: "inherit",
        fontFamily: "inherit",
        fontSize: "inherit",
        overflow: "hidden",
        cursor: "pointer",
        ":hover": {
            border: `1px solid ${tokens.colorNeutralStroke1}`,
        },
        ":focus-visible": {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: "1px",
        },
    },
    thumbnail: {
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        aspectRatio: "16 / 9",
        backgroundColor: tokens.colorNeutralBackground3,
        color: tokens.colorNeutralForeground3,
    },
    meta: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXXS,
        padding: tokens.spacingVerticalM,
    },
    title: {
        fontWeight: tokens.fontWeightSemibold,
        fontSize: tokens.fontSizeBase200,
    },
    channel: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    note: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
});

export const VideosSection = () => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { openLink } = useOverviewActions();
    const extensionVersion = useOverviewSelector((state) => state.extensionVersion);

    return (
        <section className={classes.root}>
            <SectionHeading>{loc.videos}</SectionHeading>
            <div className={classes.grid}>
                {getVideoCards(extensionVersion).map((video) => (
                    <button
                        key={video.id}
                        type="button"
                        className={classes.card}
                        onClick={() => openLink(video.url)}>
                        <span className={classes.thumbnail}>
                            <Play20Filled />
                        </span>
                        <span className={classes.meta}>
                            <Text className={classes.title}>{video.title}</Text>
                            <Text className={classes.channel}>{video.channel}</Text>
                        </span>
                    </button>
                ))}
            </div>
            <Link
                as="button"
                className={classes.note}
                onClick={() => openLink(overviewLinks.youTubeChannel)}>
                {loc.seeFullPlaylist}
            </Link>
        </section>
    );
};
