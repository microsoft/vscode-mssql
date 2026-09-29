/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import {
    CompassNorthwest20Regular,
    Glance20Regular,
    Keyboard20Regular,
    Sparkle20Regular,
    Star20Regular,
} from "@fluentui/react-icons";

import { ActionCard } from "./actionCard";
import { SidePanel } from "./sidePanel";
import { locConstants } from "../../../common/locConstants";
import { overviewLinks } from "../overviewContent";
import { OverviewTelemetryEvent } from "../../../../sharedInterfaces/overview";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";
import { ShortcutsDialog } from "./shortcutsDialog";
import { WalkthroughDialog } from "./walkthroughDialog";
import { WhatsNewDrawer } from "./whatsNewDrawer";
import { WalkthroughId, getWalkthrough } from "../walkthroughContent";

const useStyles = makeStyles({
    list: {
        display: "flex",
        flexDirection: "column",
        marginLeft: `calc(-1 * ${tokens.spacingHorizontalXS})`,
        marginRight: `calc(-1 * ${tokens.spacingHorizontalXS})`,
    },
});

export const DiscoverSection = () => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { openLink, sendTelemetry } = useOverviewActions();

    const openCard = (card: string, open: () => void) => {
        sendTelemetry(OverviewTelemetryEvent.DiscoverCardOpened, card);
        open();
    };
    const extensionVersion = useOverviewSelector((state) => state.extensionVersion);
    const [isExploreOpen, setIsExploreOpen] = useState(false);
    const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
    const openWhatsNewRequest = useOverviewSelector((state) => state.openWhatsNewRequest);
    const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(openWhatsNewRequest > 0);

    // Seeding the initial state only covers a page the trigger opened from scratch. When the page
    // was already showing, the trigger bumps the generation instead, so the drawer follows it —
    // and reopens on a later request even if the user dismissed it in between.
    useEffect(() => {
        if (openWhatsNewRequest > 0) {
            setIsWhatsNewOpen(true);
        }
    }, [openWhatsNewRequest]);

    return (
        <SidePanel title={loc.discover} icon={<Glance20Regular />}>
            <div className={classes.list}>
                <ActionCard
                    appearance="row"
                    icon={<CompassNorthwest20Regular />}
                    title={loc.exploreFeaturesTitle}
                    description={loc.exploreFeaturesDescription}
                    onClick={() => openCard("exploreFeatures", () => setIsExploreOpen(true))}
                />
                <ActionCard
                    appearance="row"
                    icon={<Keyboard20Regular />}
                    title={loc.keyboardShortcutsTitle}
                    description={loc.keyboardShortcutsDescription}
                    onClick={() => openCard("keyboardShortcuts", () => setIsShortcutsOpen(true))}
                />
                <ActionCard
                    appearance="row"
                    icon={<Star20Regular />}
                    title={loc.whatsNewTitle}
                    description={loc.whatsNewDescription(extensionVersion)}
                    onClick={() => openCard("whatsNew", () => setIsWhatsNewOpen(true))}
                />
                <ActionCard
                    appearance="row"
                    icon={<Sparkle20Regular />}
                    title={loc.devHubTitle}
                    description={loc.devHubDescription}
                    onClick={() => openCard("devHub", () => openLink(overviewLinks.devHub))}
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
        </SidePanel>
    );
};
