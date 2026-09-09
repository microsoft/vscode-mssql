/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Button,
    DrawerBody,
    DrawerFooter,
    DrawerHeader,
    DrawerHeaderTitle,
    Link,
    OverlayDrawer,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { ArrowRight12Regular, Dismiss20Regular, Star20Filled } from "@fluentui/react-icons";

import {
    ChangelogAction,
    ContentEntry,
    ContentGroup,
} from "../../../../sharedInterfaces/changelog";
import { OverviewActionId } from "../../../../sharedInterfaces/overview";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";

const useStyles = makeStyles({
    // Shell styling follows the DAB entity settings drawer: VS Code surfaces for the header and
    // footer, editorGroup borders as separators, and body padding owned by the inner scroller.
    drawer: {
        width: "min(460px, 96vw)",
        maxWidth: "calc(100vw - 32px)",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--vscode-editor-background)",
        fontFamily: "var(--vscode-font-family)",
    },
    drawerHeader: {
        padding: "12px 16px",
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        borderBottom: `1px solid var(--vscode-editorGroup-border, ${tokens.colorNeutralStroke2})`,
    },
    drawerFooter: {
        alignSelf: "stretch",
        justifyContent: "flex-end",
        columnGap: "12px",
        padding: "12px 16px",
        marginTop: 0,
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        borderTop: `1px solid var(--vscode-editorGroup-border, ${tokens.colorNeutralStroke2})`,
    },
    titleIcon: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "32px",
        height: "32px",
        borderRadius: "8px",
        backgroundColor: tokens.colorBrandBackground2,
        color: tokens.colorBrandForeground2,
    },
    titleRow: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
    },
    version: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: "11px",
        color: tokens.colorNeutralForeground3,
        backgroundColor: tokens.colorNeutralBackground3,
        padding: "3px 8px",
        borderRadius: tokens.borderRadiusMedium,
    },
    drawerBody: {
        flex: 1,
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
        padding: 0,
        boxSizing: "border-box",
        backgroundColor: "var(--vscode-editor-background)",
    },
    body: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        height: "100%",
        minHeight: 0,
        padding: "16px",
        boxSizing: "border-box",
        overflowY: "auto",
        // Reserving the gutter keeps cards from re-wrapping when expanding a section makes
        // the drawer scrollable.
        scrollbarGutter: "stable",
    },
    card: {
        display: "flex",
        flexDirection: "column",
        // Cards keep their natural height; the drawer scrolls instead of squashing them.
        flexShrink: 0,
        gap: "6px",
        padding: "12px 14px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "9px",
        backgroundColor: tokens.colorNeutralBackground1,
    },
    cardTitleRow: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    cardTitle: {
        fontSize: "14px",
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    previewBadge: {
        fontSize: "10px",
        fontWeight: tokens.fontWeightBold,
        letterSpacing: "0.2px",
        padding: "1px 7px",
        borderRadius: "9px",
        color: tokens.colorBrandForeground2,
        backgroundColor: tokens.colorBrandBackground2,
        border: `1px solid ${tokens.colorBrandStroke2}`,
    },
    cardDescription: {
        fontSize: "12.5px",
        lineHeight: "1.5",
        color: tokens.colorNeutralForeground2,
    },
    cardActions: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalM,
        marginTop: "2px",
    },
    actionLink: {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "12.5px",
    },
    secondaryAccordion: {
        flexShrink: 0,
    },
    secondaryDescription: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
    },
    footerLink: {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        marginRight: "auto",
        fontSize: "12.5px",
    },
    footer: {
        display: "flex",
        alignItems: "center",
        width: "100%",
    },
});

interface WhatsNewDrawerProps {
    onDismiss: () => void;
}

/**
 * The release-note entries the Changelog page shows, presented as a side drawer on the Overview
 * page. Content comes from the shared changelog configuration, not a second copy.
 */
export const WhatsNewDrawer = ({ onDismiss }: WhatsNewDrawerProps) => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { openLink, runAction, runChangelogAction } = useOverviewActions();
    const changelog = useOverviewSelector((state) => state.changelog);

    const runEntryAction = (action: ChangelogAction) => {
        if (action.type === "link") {
            openLink(action.value);
        } else {
            runChangelogAction(action.value);
        }
        onDismiss();
    };

    const renderEntry = (entry: ContentEntry) => (
        <div key={entry.title} className={classes.card}>
            <div className={classes.cardTitleRow}>
                <Text className={classes.cardTitle}>{entry.title}</Text>
                {entry.isPreview && <span className={classes.previewBadge}>{loc.preview}</span>}
            </div>
            <Text className={classes.cardDescription}>{entry.description}</Text>
            {entry.actions && entry.actions.length > 0 && (
                <div className={classes.cardActions}>
                    {entry.actions.map((action) => (
                        <Link
                            key={`${action.label}-${action.value}`}
                            as="button"
                            className={classes.actionLink}
                            onClick={() => runEntryAction(action)}>
                            {action.label}
                            <ArrowRight12Regular />
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );

    const secondary: ContentGroup | undefined = changelog?.secondaryContent;

    return (
        <OverlayDrawer
            open
            position="end"
            className={classes.drawer}
            onOpenChange={(_event, data) => !data.open && onDismiss()}>
            <DrawerHeader className={classes.drawerHeader}>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            icon={<Dismiss20Regular />}
                            aria-label={locConstants.common.close}
                            onClick={onDismiss}
                        />
                    }>
                    <span className={classes.titleRow}>
                        <span className={classes.titleIcon}>
                            <Star20Filled />
                        </span>
                        {loc.whatsNewTitle}
                        {changelog?.version && (
                            <span className={classes.version}>
                                {loc.version(changelog.version)}
                            </span>
                        )}
                    </span>
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody className={classes.drawerBody}>
                <div className={classes.body}>
                    {changelog?.mainContent?.entries?.map(renderEntry)}

                    {secondary?.entries && secondary.entries.length > 0 && (
                        <Accordion collapsible className={classes.secondaryAccordion}>
                            <AccordionItem value="secondary">
                                <AccordionHeader>{secondary.title}</AccordionHeader>
                                <AccordionPanel>
                                    {secondary.description && (
                                        <Text className={classes.secondaryDescription}>
                                            {secondary.description}
                                        </Text>
                                    )}
                                    {secondary.entries.map(renderEntry)}
                                </AccordionPanel>
                            </AccordionItem>
                        </Accordion>
                    )}
                </div>
            </DrawerBody>

            <DrawerFooter className={classes.drawerFooter}>
                <div className={classes.footer}>
                    <Link
                        as="button"
                        className={classes.footerLink}
                        onClick={() => {
                            // Opens the full Changelog webview rather than an external page.
                            runAction(OverviewActionId.OpenChangelog);
                            onDismiss();
                        }}>
                        {loc.whatsNewAllReleaseNotes}
                        <ArrowRight12Regular />
                    </Link>
                    <Button appearance="primary" onClick={onDismiss}>
                        {loc.whatsNewGotIt}
                    </Button>
                </div>
            </DrawerFooter>
        </OverlayDrawer>
    );
};
