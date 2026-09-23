/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Play20Filled } from "@fluentui/react-icons";

import { SectionHeading } from "./sectionHeading";
import { VideoCard, getVideoCards, overviewLinks } from "../overviewContent";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";

const videoThumbnails: Record<VideoCard["thumbnail"], string> = {
    whatsNew: require("../../../../../images/overview/videos/whats-new.webp"),
    gettingStarted: require("../../../../../images/overview/videos/getting-started.webp"),
    aiReadyApp: require("../../../../../images/overview/videos/ai-ready-app.webp"),
};

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        paddingBottom: tokens.spacingVerticalXL,
    },
    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
        gap: tokens.spacingHorizontalM,
    },
    // Secondary to the Build column above it, so the thumbnail carries the card and the frame
    // around it goes away rather than competing with the skill cards for weight.
    card: {
        display: "flex",
        flexDirection: "column",
        textAlign: "left",
        padding: 0,
        border: "none",
        backgroundColor: "transparent",
        color: "inherit",
        textDecorationLine: "none",
        fontFamily: "inherit",
        fontSize: "inherit",
        cursor: "pointer",
        ":hover": {
            backgroundColor: tokens.colorNeutralBackground1Hover,
        },
        ":focus-visible": {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: "1px",
        },
    },
    thumbnail: {
        position: "relative",
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        aspectRatio: "16 / 9",
        backgroundColor: tokens.colorNeutralBackground3,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    thumbnailImage: {
        width: "100%",
        height: "100%",
        objectFit: "cover",
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
        gap: tokens.spacingVerticalXS,
        // No card frame to sit inside any more, so the text lines up with the thumbnail edge.
        paddingTop: tokens.spacingVerticalM,
    },
    title: {
        color: tokens.colorNeutralForeground1,
        fontWeight: tokens.fontWeightSemibold,
        fontSize: tokens.fontSizeBase300,
        lineHeight: tokens.lineHeightBase300,
        // Two lines at most, so a long title does not push its subtitle out of line with the
        // cards beside it.
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
    },
    subtitle: {
        color: tokens.colorNeutralForeground2,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
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

const VideoThumbnail = ({ video }: { video: VideoCard }) => {
    const classes = useStyles();

    return (
        <span className={classes.thumbnail} aria-hidden="true">
            <img className={classes.thumbnailImage} src={videoThumbnails[video.thumbnail]} alt="" />
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
                    <button
                        type="button"
                        key={video.id}
                        title={video.url}
                        className={classes.card}
                        onClick={() => openLink(video.url)}>
                        <VideoThumbnail video={video} />
                        <span className={classes.meta}>
                            <Text className={classes.title}>{video.title}</Text>
                            <Text className={classes.subtitle}>{video.subtitle}</Text>
                        </span>
                    </button>
                ))}
            </div>
            <div className={classes.note}>
                <Text size={200}>{loc.seeFullPlaylistPrefix}</Text>
                <span>
                    <Link
                        title={overviewLinks.youTubeChannel}
                        className={classes.playlistLink}
                        onClick={() => openLink(overviewLinks.youTubeChannel)}>
                        {loc.youtube}
                    </Link>
                    .
                </span>
            </div>
        </section>
    );
};
