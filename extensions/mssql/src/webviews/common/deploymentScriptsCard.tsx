/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactElement, useState } from "react";
import { Button, Card, makeStyles, tokens } from "@fluentui/react-components";
import {
    BracesRegular,
    ChevronDownRegular,
    ChevronRightRegular,
    CodeFilled,
    DocumentChevronDoubleRegular,
} from "@fluentui/react-icons";
import { locConstants } from "./locConstants";
import { PostDeploymentScript, PostDeploymentScriptsDrawer } from "./postDeploymentScriptsDrawer";

const useStyles = makeStyles({
    scriptsCard: {
        height: "fit-content",
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
        borderRadius: "0",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        boxShadow: "none",
        backgroundColor: tokens.colorNeutralBackground1,
    },
    scriptsCardHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 12px",
        width: "100%",
        boxSizing: "border-box",
    },
    scriptsChevronButton: {
        minWidth: "24px",
        maxWidth: "24px",
        width: "24px",
        height: "24px",
        padding: "0",
        flexShrink: 0,
    },
    scriptsChevron: {
        fontSize: "20px",
        width: "20px",
        height: "20px",
    },
    scriptsCardBody: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "12px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    scriptsCardTitle: {
        fontSize: tokens.fontSizeBase400,
        lineHeight: tokens.lineHeightBase400,
        flexShrink: 0,
    },
    scriptsCardCollapsedText: {
        minWidth: 0,
        flexGrow: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: "13px",
        color: tokens.colorNeutralForeground4,
    },
    scriptsCardText: {
        fontSize: "13px",
        color: tokens.colorNeutralForeground4,
    },
    scriptsButtonRow: {
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
    },
});

/** Icon shown on a format button, keyed by the script's id. */
const scriptButtonIcons: Record<string, ReactElement> = {
    arm: <BracesRegular />,
    bicep: <CodeFilled />,
    terraform: <DocumentChevronDoubleRegular />,
};

export interface DeploymentScriptsCardProps {
    /** Infrastructure-as-code scripts to expose (order determines button/tab order). */
    scripts: PostDeploymentScript[];
    /** Persists the given script content to disk (routed to the extension host). */
    onDownload: (content: string, fileName: string) => void;
    /** Adds the given script content to the current workspace. */
    onAddToWorkspace: (content: string, fileName: string) => void;
}

/**
 * Collapsible "Download deployment scripts" card shown after a successful
 * provisioning. Renders a format button per script and opens a shared drawer
 * (on the matching tab) to preview, copy, download, or add the script to the
 * workspace.
 */
export const DeploymentScriptsCard: React.FC<DeploymentScriptsCardProps> = ({
    scripts,
    onDownload,
    onAddToWorkspace,
}) => {
    const classes = useStyles();
    const [cardOpen, setCardOpen] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [initialTabId, setInitialTabId] = useState<string>(scripts[0]?.id ?? "");

    const openDrawer = (tabId: string) => {
        setInitialTabId(tabId);
        setDrawerOpen(true);
    };

    return (
        <>
            <Card className={classes.scriptsCard}>
                <div className={classes.scriptsCardHeader}>
                    <Button
                        type="button"
                        appearance="subtle"
                        className={classes.scriptsChevronButton}
                        aria-expanded={cardOpen}
                        icon={
                            cardOpen ? (
                                <ChevronDownRegular className={classes.scriptsChevron} />
                            ) : (
                                <ChevronRightRegular className={classes.scriptsChevron} />
                            )
                        }
                        onClick={() => setCardOpen((prev) => !prev)}
                    />
                    <span className={classes.scriptsCardTitle}>
                        {locConstants.deploymentScripts.downloadDeploymentScriptsTitle}
                    </span>
                    {!cardOpen && (
                        <span
                            className={classes.scriptsCardCollapsedText}
                            title={
                                locConstants.deploymentScripts.downloadDeploymentScriptsDescription
                            }>
                            {locConstants.deploymentScripts.downloadDeploymentScriptsDescription}
                        </span>
                    )}
                </div>
                {cardOpen && (
                    <div className={classes.scriptsCardBody}>
                        <span className={classes.scriptsCardText}>
                            {locConstants.deploymentScripts.downloadDeploymentScriptsDescription}
                        </span>
                        <div className={classes.scriptsButtonRow}>
                            {scripts.map((script) => (
                                <Button
                                    key={script.id}
                                    appearance="secondary"
                                    icon={scriptButtonIcons[script.id]}
                                    onClick={() => openDrawer(script.id)}>
                                    {script.label}
                                </Button>
                            ))}
                        </div>
                    </div>
                )}
            </Card>
            <PostDeploymentScriptsDrawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                scripts={scripts}
                initialTabId={initialTabId}
                onDownload={onDownload}
                onAddToWorkspace={onAddToWorkspace}
            />
        </>
    );
};
