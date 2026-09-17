/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tab, TabList, makeStyles, tokens } from "@fluentui/react-components";
import { useState } from "react";

import { AgentSkillsPanel } from "./agentSkillsPanel";
import { DevContainersPanel } from "./devContainersPanel";
import { SectionHeading } from "./sectionHeading";
import { WalkthroughsPanel } from "./walkthroughsPanel";
import { locConstants } from "../../../common/locConstants";
import { useOverviewSelector } from "../overviewSelector";

type BuildTab = "agentSkills" | "walkthroughs" | "devContainers";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
    panel: {
        paddingTop: tokens.spacingVerticalM,
        paddingBottom: tokens.spacingVerticalXL,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
});

export const BuildSection = () => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const [selectedTab, setSelectedTab] = useState<BuildTab>("agentSkills");
    // Already attached to a dev container: there is nothing left to set up.
    const isInDevContainer = useOverviewSelector((state) => state.isInDevContainer);

    return (
        <section className={classes.root}>
            <SectionHeading>{loc.build}</SectionHeading>
            <TabList
                selectedValue={selectedTab}
                onTabSelect={(_event, data) => setSelectedTab(data.value as BuildTab)}>
                <Tab value="agentSkills">{loc.agentSkillsTab}</Tab>
                <Tab value="walkthroughs">{loc.walkthroughsTab}</Tab>
                {!isInDevContainer && <Tab value="devContainers">{loc.devContainersTab}</Tab>}
            </TabList>
            <div className={classes.panel}>
                {selectedTab === "agentSkills" && <AgentSkillsPanel />}
                {selectedTab === "walkthroughs" && <WalkthroughsPanel />}
                {selectedTab === "devContainers" && !isInDevContainer && <DevContainersPanel />}
            </div>
        </section>
    );
};
