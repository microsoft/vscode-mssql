/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from "@fluentui/react-components";
import { useState } from "react";
import {
    CompassNorthwest20Regular,
    Keyboard20Regular,
    Sparkle20Regular,
    Star20Regular,
} from "@fluentui/react-icons";

import { ActionCard } from "./actionCard";
import { SectionHeading } from "./sectionHeading";
import { locConstants } from "../../../common/locConstants";
import { overviewLinks } from "../overviewContent";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";
import { ShortcutsDialog } from "./shortcutsDialog";
import { WalkthroughDialog } from "./walkthroughDialog";
import { WhatsNewDrawer } from "./whatsNewDrawer";
import { WalkthroughId, getWalkthrough } from "../walkthroughContent";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
    list: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
});

export const DiscoverSection = () => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { openLink } = useOverviewActions();
    const extensionVersion = useOverviewSelector((state) => state.extensionVersion);
    const [isExploreOpen, setIsExploreOpen] = useState(false);
    const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
    const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(false);

    return (
        <section className={classes.root}>
            <SectionHeading>{loc.discover}</SectionHeading>
            <div className={classes.list}>
                <ActionCard
                    icon={<CompassNorthwest20Regular />}
                    title={loc.exploreFeaturesTitle}
                    description={loc.exploreFeaturesDescription}
                    onClick={() => setIsExploreOpen(true)}
                />
                <ActionCard
                    icon={<Keyboard20Regular />}
                    title={loc.keyboardShortcutsTitle}
                    description={loc.keyboardShortcutsDescription}
                    onClick={() => setIsShortcutsOpen(true)}
                />
                <ActionCard
                    icon={<Star20Regular />}
                    title={loc.whatsNewTitle}
                    description={loc.whatsNewDescription(extensionVersion)}
                    onClick={() => setIsWhatsNewOpen(true)}
                />
                <ActionCard
                    icon={<Sparkle20Regular />}
                    title={loc.devHubTitle}
                    description={loc.devHubDescription}
                    onClick={() => openLink(overviewLinks.devHub)}
                />
            </div>

            {isExploreOpen && (
                <WalkthroughDialog
                    walkthrough={getWalkthrough(WalkthroughId.Features)}
                    onDismiss={() => setIsExploreOpen(false)}
                />
            )}
            {isShortcutsOpen && <ShortcutsDialog onDismiss={() => setIsShortcutsOpen(false)} />}
            {isWhatsNewOpen && <WhatsNewDrawer onDismiss={() => setIsWhatsNewOpen(false)} />}
        </section>
    );
};
