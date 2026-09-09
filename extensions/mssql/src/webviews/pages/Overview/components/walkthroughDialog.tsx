/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogSurface,
    Text,
    makeStyles,
    mergeClasses,
    tokens,
} from "@fluentui/react-components";
import { Dismiss20Regular, TextBulletListSquare20Regular } from "@fluentui/react-icons";
import { Fragment, useState } from "react";

import { Walkthrough } from "../walkthroughContent";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";

const useStyles = makeStyles({
    surface: {
        maxWidth: "1000px",
        width: "90vw",
        padding: 0,
    },
    layout: {
        position: "relative",
        display: "grid",
        gridTemplateColumns: "260px minmax(0, 1fr)",
        minHeight: "460px",
        "@media (max-width: 720px)": {
            gridTemplateColumns: "minmax(0, 1fr)",
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
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        // The feature gallery is long; the rail scrolls rather than stretching the dialog.
        overflowY: "auto",
        maxHeight: "60vh",
    },
    navGroup: {
        padding: "12px 10px 4px",
        fontSize: "11px",
        fontWeight: tokens.fontWeightSemibold,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: tokens.colorNeutralForeground3,
    },
    navButton: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        width: "100%",
        textAlign: "left",
        padding: "9px 10px",
        border: "none",
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: "transparent",
        color: tokens.colorNeutralForeground2,
        fontFamily: "inherit",
        fontSize: "13px",
        cursor: "pointer",
        ":hover": {
            backgroundColor: tokens.colorNeutralBackground1Hover,
        },
        ":focus-visible": {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
        },
    },
    navButtonActive: {
        backgroundColor: tokens.colorNeutralBackground1Selected,
        color: tokens.colorBrandForeground1,
        fontWeight: tokens.fontWeightSemibold,
    },
    navIcon: {
        display: "flex",
        flexShrink: 0,
    },
    main: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        padding: "22px 24px",
        minWidth: 0,
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
        marginTop: tokens.spacingVerticalS,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        overflow: "hidden",
        backgroundColor: tokens.colorNeutralBackground3,
    },
    stageBar: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "8px 12px",
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
        backgroundColor: tokens.colorNeutralBackground4,
    },
    stageDot: {
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        backgroundColor: tokens.colorNeutralForeground4,
    },
    stageTab: {
        marginLeft: "6px",
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: "11px",
        color: tokens.colorNeutralForeground3,
    },
    // Placeholder until the recorded walkthrough is dropped in; shows the alt text only.
    stagePlaceholder: {
        display: "flex",
        minHeight: "260px",
        padding: "14px 16px",
        fontSize: "13px",
        color: tokens.colorNeutralForeground2,
    },
    stageImage: {
        display: "block",
        width: "100%",
        height: "auto",
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

/**
 * In-page walkthrough: a step list on the left, and the selected step's copy, call to action
 * and screenshot on the right.
 */
export const WalkthroughDialog = ({ walkthrough, onDismiss }: WalkthroughDialogProps) => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { runAction, openLink } = useOverviewActions();
    const [selectedIndex, setSelectedIndex] = useState(0);

    const step = walkthrough.steps[selectedIndex];

    const runStepAction = () => {
        if (!step.action) {
            return;
        }
        if (step.action.url) {
            openLink(step.action.url);
        } else if (step.action.actionId) {
            runAction(step.action.actionId);
        }
        onDismiss();
    };

    return (
        <Dialog open onOpenChange={(_event, data) => !data.open && onDismiss()}>
            <DialogSurface className={classes.surface}>
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
                            <Text className={classes.sideTitle}>{walkthrough.title}</Text>
                            <Text className={classes.sideSubtitle}>{walkthrough.subtitle}</Text>
                        </div>
                        <div className={classes.nav} role="tablist">
                            {walkthrough.steps.map((navStep, index) => (
                                <Fragment key={navStep.id}>
                                    {navStep.category &&
                                        navStep.category !==
                                            walkthrough.steps[index - 1]?.category && (
                                            <div className={classes.navGroup}>
                                                {navStep.category}
                                            </div>
                                        )}
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={index === selectedIndex}
                                        className={mergeClasses(
                                            classes.navButton,
                                            index === selectedIndex && classes.navButtonActive,
                                        )}
                                        onClick={() => setSelectedIndex(index)}>
                                        <span className={classes.navIcon}>
                                            <TextBulletListSquare20Regular />
                                        </span>
                                        {navStep.title}
                                    </button>
                                </Fragment>
                            ))}
                        </div>
                    </div>

                    <div className={classes.main}>
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
                                onClick={runStepAction}>
                                {step.action.label}
                            </Button>
                        )}
                        <div className={classes.stage}>
                            <div className={classes.stageBar}>
                                <span className={classes.stageDot} />
                                <span className={classes.stageDot} />
                                <span className={classes.stageDot} />
                                <span className={classes.stageTab}>
                                    {loc.walkthroughMediaTab(step.title)}
                                </span>
                            </div>
                            {step.image ? (
                                <img
                                    className={classes.stageImage}
                                    src={step.image}
                                    alt={loc.walkthroughMediaAlt}
                                />
                            ) : (
                                <div className={classes.stagePlaceholder}>
                                    {loc.walkthroughMediaAlt}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </DialogSurface>
        </Dialog>
    );
};
