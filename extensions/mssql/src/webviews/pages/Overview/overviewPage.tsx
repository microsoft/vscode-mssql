/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";

import { BuildSection } from "./components/buildSection";
import { DiscoverSection } from "./components/discoverSection";
import { EventBanner } from "./components/eventBanner";
import { OverviewHeader } from "./components/overviewHeader";
import { RecentFilesSection } from "./components/recentFilesSection";
import { ResourcesSection } from "./components/resourcesSection";
import { VideosSection } from "./components/videosSection";

const useStyles = makeStyles({
    root: {
        height: "100%",
        overflowY: "auto",
        boxSizing: "border-box",
        backgroundColor: "var(--vscode-editor-background)",
        color: "var(--vscode-foreground)",
    },
    shell: {
        width: "100%",
        maxWidth: "1200px",
        margin: "0 auto",
        padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXXL}`,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalL,
    },
    columns: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 300px",
        gap: tokens.spacingHorizontalXXXL,
        alignItems: "start",
        "@media (max-width: 900px)": {
            gridTemplateColumns: "minmax(0, 1fr)",
        },
    },
    column: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXL,
        minWidth: 0,
    },
    buildColumn: {
        gap: tokens.spacingVerticalXXL,
    },
    railColumn: {
        gap: tokens.spacingVerticalM,
    },
});

export const OverviewPage = () => {
    const classes = useStyles();

    return (
        <div className={classes.root}>
            <div className={classes.shell}>
                <EventBanner />
                <OverviewHeader />
                <div className={classes.columns}>
                    <div className={mergeClasses(classes.column, classes.buildColumn)}>
                        <BuildSection />
                        <VideosSection />
                    </div>
                    <div className={mergeClasses(classes.column, classes.railColumn)}>
                        <RecentFilesSection />
                        <DiscoverSection />
                        <ResourcesSection />
                    </div>
                </div>
            </div>
        </div>
    );
};
