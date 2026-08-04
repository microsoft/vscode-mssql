/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from "react";
import {
    Button,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    OverlayDrawer,
    Tab,
    TabList,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    ArrowDownloadRegular,
    CheckmarkRegular,
    CopyRegular,
    Dismiss24Regular,
    FolderAddRegular,
} from "@fluentui/react-icons";
import { locConstants } from "./locConstants";

const useStyles = makeStyles({
    header: {
        paddingTop: "12px",
    },
    headerDivider: {
        marginTop: "8px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    body: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        height: "100%",
    },
    codeBlock: {
        flex: 1,
        margin: 0,
        padding: "12px",
        overflow: "auto",
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: "12px",
        whiteSpace: "pre",
        backgroundColor: tokens.colorNeutralBackground3,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        color: tokens.colorNeutralForeground1,
    },
    footer: {
        display: "flex",
        gap: "16px",
        justifyContent: "flex-end",
        paddingTop: "8px",
        paddingBottom: "16px",
    },
    actionButton: {
        padding: "8px",
    },
    copyButton: {
        minWidth: "16px",
        width: "84px",
    },
});

/** A single post-deployment script option shown in the drawer. */
export interface PostDeploymentScript {
    /** Stable identifier used to track the selected tab. */
    id: string;
    /** Localized, human-readable label for the format (e.g. "Bicep"). */
    label: string;
    /** The script content. */
    content: string;
    /** Suggested file name (with extension) used when downloading. */
    fileName: string;
}

interface PostDeploymentScriptsDrawerProps {
    /** Whether the drawer is open. */
    open: boolean;
    /** Called when the drawer requests to close. */
    onClose: () => void;
    /** The available script formats to display. */
    scripts: PostDeploymentScript[];
    /** Id of the tab to select when the drawer opens. Defaults to the first script. */
    initialTabId?: string;
    /** Prompts the user to save the given script content to a file. */
    onDownload: (content: string, fileName: string) => void;
    /** Adds the given script to the workspace. */
    onAddToWorkspace: (content: string, fileName: string) => void;
}

/**
 * Generic, accessible drawer that displays post-deployment infrastructure-as-code
 * scripts in one or more formats, with copy, download, and add-to-workspace actions.
 * Reused across deployment wizards.
 */
export const PostDeploymentScriptsDrawer: React.FC<PostDeploymentScriptsDrawerProps> = ({
    open,
    onClose,
    scripts,
    initialTabId,
    onDownload,
    onAddToWorkspace,
}) => {
    const classes = useStyles();
    const [selectedId, setSelectedId] = useState(initialTabId ?? scripts[0]?.id);
    const [copied, setCopied] = useState(false);

    // When the drawer opens, honor the requested initial tab.
    useEffect(() => {
        if (open) {
            setSelectedId(initialTabId ?? scripts[0]?.id);
            setCopied(false);
        }
    }, [open, initialTabId, scripts]);

    const selectedScript = scripts.find((script) => script.id === selectedId) ?? scripts[0];

    if (!selectedScript) {
        return undefined;
    }

    const handleCopy = async () => {
        await navigator.clipboard.writeText(selectedScript.content);
        setCopied(true);
        requestAnimationFrame(() => window.setTimeout(() => setCopied(false), 2000));
    };

    return (
        <OverlayDrawer
            position="end"
            size="medium"
            open={open}
            onOpenChange={(_, data) => {
                if (!data.open) {
                    onClose();
                }
            }}>
            <DrawerHeader className={classes.header}>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label={locConstants.common.close}
                            icon={<Dismiss24Regular />}
                            onClick={onClose}
                        />
                    }>
                    {locConstants.deploymentScripts.exportInfrastructureAsCode}
                </DrawerHeaderTitle>
                <div className={classes.headerDivider} />
            </DrawerHeader>
            <DrawerBody className={classes.body}>
                {scripts.length > 1 && (
                    <TabList
                        selectedValue={selectedScript.id}
                        onTabSelect={(_, data) => {
                            setSelectedId(data.value as string);
                            setCopied(false);
                        }}>
                        {scripts.map((script) => (
                            <Tab key={script.id} value={script.id}>
                                {script.label}
                            </Tab>
                        ))}
                    </TabList>
                )}
                <pre className={classes.codeBlock} tabIndex={0} aria-label={selectedScript.content}>
                    {selectedScript.content}
                </pre>
                <div className={classes.footer}>
                    <Button
                        appearance="primary"
                        className={classes.copyButton}
                        icon={copied ? <CheckmarkRegular /> : <CopyRegular />}
                        onClick={() => void handleCopy()}>
                        {copied
                            ? locConstants.deploymentScripts.copied
                            : locConstants.deploymentScripts.copy}
                    </Button>
                    <Button
                        appearance="secondary"
                        className={classes.actionButton}
                        icon={<ArrowDownloadRegular />}
                        onClick={() => onDownload(selectedScript.content, selectedScript.fileName)}>
                        {locConstants.deploymentScripts.download}
                    </Button>
                    <Button
                        appearance="secondary"
                        className={classes.actionButton}
                        icon={<FolderAddRegular />}
                        onClick={() =>
                            onAddToWorkspace(selectedScript.content, selectedScript.fileName)
                        }>
                        {locConstants.deploymentScripts.addToWorkspace}
                    </Button>
                </div>
            </DrawerBody>
        </OverlayDrawer>
    );
};
