/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogSurface,
    Tab,
    TabList,
    Text,
    makeStyles,
    mergeClasses,
    tokens,
    useId,
} from "@fluentui/react-components";
import { Dismiss20Regular, TextBulletListSquare20Regular } from "@fluentui/react-icons";
import { Fragment, type KeyboardEvent, useState } from "react";

import { Walkthrough } from "../walkthroughContent";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";

const useStyles = makeStyles({
    surface: {
        maxWidth: "1000px",
        width: "90vw",
        height: "min(680px, 90vh)",
        padding: 0,
        overflow: "hidden",
    },
    layout: {
        position: "relative",
        display: "grid",
        gridTemplateColumns: "260px minmax(0, 1fr)",
        height: "100%",
        minHeight: 0,
        "@media (max-width: 720px)": {
            gridTemplateColumns: "minmax(0, 1fr)",
            gridTemplateRows: "auto minmax(0, 1fr)",
        },
    },
    side: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalL,
        padding: "22px 16px",
        borderRightWidth: "1px",
        borderRightStyle: "solid",
        borderRightColor: tokens.colorNeutralStroke2,
        backgroundColor: tokens.colorNeutralBackground2,
        minHeight: 0,
        overflow: "hidden",
        "@media (max-width: 720px)": {
            maxHeight: "180px",
            borderRightWidth: 0,
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderBottomColor: tokens.colorNeutralStroke2,
        },
    },
    sideHeading: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        padding: "0 8px",
    },
    sideTitle: {
        fontSize: "15px",
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    sideSubtitle: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
    },
    nav: {
        overflowY: "auto",
        overflowX: "hidden",
        minHeight: 0,
        flex: "1 1 0",
        padding: "2px",
    },
    galleryNav: {
        overflowY: "scroll",
        scrollbarGutter: "stable",
    },
    navGroup: {
        padding: "12px 10px 4px",
        fontSize: "11px",
        fontWeight: tokens.fontWeightSemibold,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: tokens.colorNeutralForeground3,
    },
    navTab: {
        width: "100%",
        justifyContent: "flex-start",
    },
    main: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        padding: "22px 24px",
        minWidth: 0,
        minHeight: 0,
        overflowY: "auto",
    },
    kicker: {
        fontSize: "11.5px",
        fontWeight: tokens.fontWeightSemibold,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: tokens.colorBrandForeground1,
    },
    title: {
        marginTop: 0,
        marginBottom: 0,
        fontSize: "22px",
        lineHeight: "28px",
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    description: {
        fontSize: "13px",
        lineHeight: "1.5",
        color: tokens.colorNeutralForeground2,
    },
    cta: {
        alignSelf: "flex-start",
    },
    stage: {
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        overflow: "hidden",
        backgroundColor: tokens.colorNeutralBackground3,
    },
    stageMedia: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        aspectRatio: "16 / 9",
        overflow: "hidden",
    },
    stagePlaceholder: {
        display: "flex",
        width: "100%",
        height: "100%",
        padding: "14px 16px",
        fontSize: "13px",
        color: tokens.colorNeutralForeground2,
    },
    stageImage: {
        display: "block",
        width: "100%",
        height: "100%",
        objectFit: "contain",
    },
    close: {
        position: "absolute",
        top: "10px",
        right: "10px",
    },
});

interface WalkthroughDialogProps {
    walkthrough: Walkthrough;
    onDismiss: () => void;
}

export const WalkthroughDialog = ({ walkthrough, onDismiss }: WalkthroughDialogProps) => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { runAction, openLink } = useOverviewActions();
    const [selectedIndex, setSelectedIndex] = useState(0);
    const titleId = useId("walkthrough-title-");

    const step = walkthrough.steps[selectedIndex];

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
        ) {
            return;
        }

        const target = event.target as HTMLElement;
        if (target.closest("[role='tablist'], input, textarea, select, [contenteditable='true']")) {
            return;
        }

        const direction =
            event.key === "ArrowLeft" || event.key === "ArrowUp"
                ? -1
                : event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : 0;
        const nextIndex = selectedIndex + direction;
        if (direction === 0 || nextIndex < 0 || nextIndex >= walkthrough.steps.length) {
            return;
        }

        event.preventDefault();
        setSelectedIndex(nextIndex);
    };

    const runStepAction = () => {
        if (!step.action) {
            return;
        }
        if (step.action.url) {
            openLink(step.action.url);
            return;
        }
        if (step.action.actionId) {
            runAction(step.action.actionId);
        }
    };

    return (
        <Dialog open onOpenChange={(_event, data) => !data.open && onDismiss()}>
            {/*
             * The layout is custom rather than a DialogTitle/DialogBody, so the surface is pointed
             * at the visible walkthrough title; without it screen readers announce an unnamed
             * dialog.
             */}
            <DialogSurface
                className={classes.surface}
                onKeyDown={handleKeyDown}
                aria-labelledby={titleId}>
                <div className={classes.layout}>
                    <Button
                        className={classes.close}
                        appearance="subtle"
                        icon={<Dismiss20Regular />}
                        aria-label={locConstants.common.close}
                        onClick={onDismiss}
                    />

                    <div className={classes.side}>
                        <div className={classes.sideHeading}>
                            <Text className={classes.sideTitle} id={titleId}>
                                {walkthrough.title}
                            </Text>
                            <Text className={classes.sideSubtitle}>{walkthrough.subtitle}</Text>
                        </div>
                        <TabList
                            className={mergeClasses(
                                classes.nav,
                                walkthrough.kind === "gallery" && classes.galleryNav,
                            )}
                            vertical
                            selectedValue={step.id}
                            onTabSelect={(_event, data) => {
                                const nextIndex = walkthrough.steps.findIndex(
                                    (candidate) => candidate.id === data.value,
                                );
                                if (nextIndex >= 0) {
                                    setSelectedIndex(nextIndex);
                                }
                            }}>
                            {walkthrough.steps.map((navStep, index) => (
                                <Fragment key={navStep.id}>
                                    {navStep.category &&
                                        navStep.category !==
                                            walkthrough.steps[index - 1]?.category && (
                                            <div className={classes.navGroup} role="presentation">
                                                {navStep.category}
                                            </div>
                                        )}
                                    <Tab
                                        id={`walkthrough-tab-${navStep.id}`}
                                        aria-controls="walkthrough-tabpanel"
                                        className={classes.navTab}
                                        icon={<TextBulletListSquare20Regular />}
                                        value={navStep.id}>
                                        {navStep.title}
                                    </Tab>
                                </Fragment>
                            ))}
                        </TabList>
                    </div>

                    <div
                        id="walkthrough-tabpanel"
                        role="tabpanel"
                        aria-labelledby={`walkthrough-tab-${step.id}`}
                        className={classes.main}>
                        <Text className={classes.kicker}>
                            {walkthrough.kind === "gallery"
                                ? step.category
                                : loc.stepOfTotal(selectedIndex + 1, walkthrough.steps.length)}
                        </Text>
                        <Text as="h2" className={classes.title}>
                            {step.title}
                        </Text>
                        <Text className={classes.description}>{step.description}</Text>
                        {step.action && (
                            <Button
                                className={classes.cta}
                                appearance="primary"
                                title={step.action.url}
                                onClick={runStepAction}>
                                {step.action.label}
                            </Button>
                        )}
                        <div className={classes.stage}>
                            <div className={classes.stageMedia}>
                                {step.image ? (
                                    <img
                                        className={classes.stageImage}
                                        src={step.image}
                                        alt={step.title}
                                    />
                                ) : (
                                    <div className={classes.stagePlaceholder}>
                                        {loc.walkthroughMediaAlt}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </DialogSurface>
        </Dialog>
    );
};
