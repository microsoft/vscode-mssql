/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Database20Regular, Play20Filled, Pulse20Regular } from "@fluentui/react-icons";

import { SectionHeading } from "./sectionHeading";
import { VideoCard, getVideoCards, overviewLinks } from "../overviewContent";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";
import { GithubCopilot16Regular, Schema16Regular } from "../../../common/icons/fluentIcons";

const extensionIcon = require("../../../../../images/extensionIcon.png");

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        paddingBottom: tokens.spacingVerticalXL,
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
        textDecorationLine: "none",
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
    thumbnailPattern: {
        position: "absolute",
        inset: 0,
        backgroundImage: `linear-gradient(${tokens.colorNeutralStroke3} 1px, transparent 1px), linear-gradient(90deg, ${tokens.colorNeutralStroke3} 1px, transparent 1px)`,
        backgroundSize: "24px 24px",
        opacity: 0.35,
    },
    thumbnailFeatures: {
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 14%",
    },
    featureTile: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "48px",
        height: "48px",
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: tokens.borderRadiusLarge,
        color: tokens.colorBrandForeground1,
        backgroundColor: tokens.colorNeutralBackground1,
        boxShadow: tokens.shadow4,
        "& svg": {
            width: "28px",
            height: "28px",
        },
    },
    productLogo: {
        width: "34px",
        height: "34px",
        objectFit: "contain",
    },
    playIcon: {
        position: "absolute",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "40px",
        height: "40px",
        borderRadius: "50%",
        color: tokens.colorNeutralForegroundInverted,
        backgroundColor: "rgba(0, 0, 0, 0.68)",
        boxShadow: tokens.shadow8,
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
    subtitle: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    note: {
        display: "flex",
        alignItems: "baseline",
        gap: tokens.spacingHorizontalXXS,
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    playlistLink: {
        color: tokens.colorBrandForegroundLink,
        fontSize: tokens.fontSizeBase200,
        textDecorationLine: "underline",
    },
});

const VideoThumbnail = ({ kind }: { kind: VideoCard["thumbnail"] }) => {
    const classes = useStyles();

    const features =
        kind === "copilotSql" ? (
            <>
                <span className={classes.featureTile}>
                    <GithubCopilot16Regular />
                </span>
                <span className={classes.featureTile}>
                    <Database20Regular />
                </span>
            </>
        ) : kind === "whatsNew" ? (
            <>
                <span className={classes.featureTile}>
                    <img className={classes.productLogo} src={extensionIcon} alt="" />
                </span>
                <span className={classes.featureTile}>
                    <Pulse20Regular />
                </span>
            </>
        ) : (
            <>
                <span className={classes.featureTile}>
                    <Schema16Regular />
                </span>
                <span className={classes.featureTile}>
                    <GithubCopilot16Regular />
                </span>
            </>
        );

    return (
        <span className={classes.thumbnail} aria-hidden="true">
            <span className={classes.thumbnailPattern} />
            <span className={classes.thumbnailFeatures}>{features}</span>
            <span className={classes.playIcon}>
                <Play20Filled />
            </span>
        </span>
    );
};

export const VideosSection = () => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { openLink } = useOverviewActions();

    return (
        <section className={classes.root}>
            <SectionHeading>{loc.videos}</SectionHeading>
            <div className={classes.grid}>
                {getVideoCards().map((video) => (
                    <a
                        key={video.id}
                        href={video.url}
                        title={video.url}
                        className={classes.card}
                        onClick={(event) => {
                            event.preventDefault();
                            openLink(video.url);
                        }}>
                        <VideoThumbnail kind={video.thumbnail} />
                        <span className={classes.meta}>
                            <Text className={classes.title}>{video.title}</Text>
                            <Text className={classes.subtitle}>{video.subtitle}</Text>
                        </span>
                    </a>
                ))}
            </div>
            <div className={classes.note}>
                <Text size={200}>{loc.seeFullPlaylistPrefix}</Text>
                <span>
                    <Link
                        href={overviewLinks.youTubeChannel}
                        title={overviewLinks.youTubeChannel}
                        className={classes.playlistLink}
                        onClick={(event) => {
                            event.preventDefault();
                            openLink(overviewLinks.youTubeChannel);
                        }}>
                        {loc.youtube}
                    </Link>
                    .
                </span>
            </div>
        </section>
    );
};
