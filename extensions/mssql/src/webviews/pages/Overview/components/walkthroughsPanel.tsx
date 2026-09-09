/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from "@fluentui/react-components";
import {
    BotSparkle20Regular,
    DatabasePlugConnected20Regular,
    Flow20Regular,
} from "@fluentui/react-icons";
import { ReactNode, useState } from "react";

import { ActionCard } from "./actionCard";
import { WalkthroughDialog } from "./walkthroughDialog";
import { WalkthroughId, getWalkthrough } from "../walkthroughContent";
import { locConstants } from "../../../common/locConstants";

const walkthroughIcons: Partial<Record<WalkthroughId, ReactNode>> = {
    [WalkthroughId.Connect]: <DatabasePlugConnected20Regular />,
    [WalkthroughId.App]: <Flow20Regular />,
    [WalkthroughId.Copilot]: <BotSparkle20Regular />,
};

const useStyles = makeStyles({
    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: tokens.spacingHorizontalM,
    },
});

export const WalkthroughsPanel = () => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const [activeWalkthrough, setActiveWalkthrough] = useState<WalkthroughId | undefined>(
        undefined,
    );

    const cards = [
        {
            id: WalkthroughId.Connect,
            title: loc.walkthroughConnectTitle,
            description: loc.walkthroughConnectDescription,
        },
        {
            id: WalkthroughId.App,
            title: loc.walkthroughAppTitle,
            description: loc.walkthroughAppDescription,
        },
        {
            id: WalkthroughId.Copilot,
            title: loc.walkthroughCopilotTitle,
            description: loc.walkthroughCopilotDescription,
        },
    ];

    return (
        <div className={classes.grid}>
            {cards.map((card) => (
                <ActionCard
                    key={card.id}
                    icon={walkthroughIcons[card.id]}
                    title={card.title}
                    description={card.description}
                    onClick={() => setActiveWalkthrough(card.id)}
                />
            ))}

            {activeWalkthrough && (
                <WalkthroughDialog
                    walkthrough={getWalkthrough(activeWalkthrough)}
                    onDismiss={() => setActiveWalkthrough(undefined)}
                />
            )}
        </div>
    );
};
