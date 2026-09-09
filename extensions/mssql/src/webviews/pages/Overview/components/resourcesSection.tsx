/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, Text, makeStyles, tokens } from "@fluentui/react-components";
import {
    Bug20Regular,
    Chat20Regular,
    Document20Regular,
    Lightbulb20Regular,
    Map20Regular,
    Video20Regular,
} from "@fluentui/react-icons";
import { ReactNode } from "react";

import { SectionHeading } from "./sectionHeading";
import { locConstants } from "../../../common/locConstants";
import { overviewLinks } from "../overviewContent";
import { useOverviewActions } from "../useOverviewActions";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
    },
    group: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
    },
    groupLabel: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
    },
    link: {
        display: "inline-flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
    },
});

interface ResourceLink {
    icon: ReactNode;
    label: string;
    url: string;
}

export const ResourcesSection = () => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { openLink } = useOverviewActions();

    const resources: ResourceLink[] = [
        {
            icon: <Video20Regular />,
            label: loc.watchDemos,
            url: overviewLinks.youTubeChannel,
        },
        { icon: <Map20Regular />, label: loc.viewRoadmap, url: overviewLinks.repository },
        {
            icon: <Document20Regular />,
            label: loc.readDocs,
            url: overviewLinks.documentation,
        },
    ];

    const feedback: ResourceLink[] = [
        { icon: <Bug20Regular />, label: loc.reportBug, url: overviewLinks.reportBug },
        {
            icon: <Lightbulb20Regular />,
            label: loc.requestFeature,
            url: overviewLinks.requestFeature,
        },
        { icon: <Chat20Regular />, label: loc.joinDiscussions, url: overviewLinks.discussions },
    ];

    const renderGroup = (label: string, links: ResourceLink[]) => (
        <div className={classes.group}>
            <Text className={classes.groupLabel}>{label}</Text>
            {links.map((link) => (
                <Link
                    key={link.url}
                    as="button"
                    className={classes.link}
                    onClick={() => openLink(link.url)}>
                    {link.icon}
                    {link.label}
                </Link>
            ))}
        </div>
    );

    return (
        <section className={classes.root}>
            <SectionHeading>{loc.resourcesAndFeedback}</SectionHeading>
            {renderGroup(loc.resources, resources)}
            {renderGroup(loc.feedback, feedback)}
        </section>
    );
};
