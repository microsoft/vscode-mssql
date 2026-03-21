/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, useEffect, useMemo, useState } from "react";
import { Button, makeStyles } from "@fluentui/react-components";
import { ArrowLeft20Regular, ArrowRight20Regular } from "@fluentui/react-icons";
import { DialogPageShellContentWidth } from "./dialogPageShell";
import { WizardPageShell } from "./wizardPageShell";
import { locConstants } from "./locConstants";

const useStyles = makeStyles({
    footerGroup: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
    },
    footerButtonContent: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
    },
});

export interface WizardPageRenderContext {
    currentIndex: number;
    totalPages: number;
    goToPage: (pageId: string) => void;
    goNext: () => Promise<void>;
    goPrevious: () => Promise<void>;
}

export interface WizardPageDefinition {
    id: string;
    title: string;
    render: (context: WizardPageRenderContext) => ReactNode;
    isPageValid?: boolean | ((context: WizardPageRenderContext) => boolean);
    canGoBack?: boolean | ((context: WizardPageRenderContext) => boolean);
    canGoNext?: boolean | ((context: WizardPageRenderContext) => boolean);
    nextLabel?: string | ((context: WizardPageRenderContext) => string);
    onNext?: (context: WizardPageRenderContext) => void | boolean | Promise<void | boolean>;
    onPrevious?: (context: WizardPageRenderContext) => void | boolean | Promise<void | boolean>;
    onEnter?: (context: WizardPageRenderContext) => void | Promise<void>;
    showCancel?: boolean | ((context: WizardPageRenderContext) => boolean);
    extraFooterActions?: ReactNode | ((context: WizardPageRenderContext) => ReactNode);
}

export interface WizardProps {
    icon?: ReactNode;
    title: string;
    pages: WizardPageDefinition[];
    onCancel: () => void;
    maxContentWidth?: DialogPageShellContentWidth;
    initialPageId?: string;
}

export const Wizard = ({
    icon,
    title,
    pages,
    onCancel,
    maxContentWidth = "medium",
    initialPageId,
}: WizardProps) => {
    const classes = useStyles();
    const initialIndex = useMemo(() => {
        if (!initialPageId) {
            return 0;
        }

        const matchingIndex = pages.findIndex((page) => page.id === initialPageId);
        return matchingIndex >= 0 ? matchingIndex : 0;
    }, [initialPageId, pages]);
    const [currentIndex, setCurrentIndex] = useState(initialIndex);

    useEffect(() => {
        setCurrentIndex(initialIndex);
    }, [initialIndex]);

    const currentPage = pages[currentIndex];
    const totalPages = pages.length;

    const goToPage = (pageId: string) => {
        const pageIndex = pages.findIndex((page) => page.id === pageId);
        if (pageIndex >= 0) {
            setCurrentIndex(pageIndex);
        }
    };

    const goNext = async () => {
        const result = await currentPage.onNext?.(pageContext);
        if (result === false) {
            return;
        }

        if (currentIndex < totalPages - 1) {
            setCurrentIndex((index) => Math.min(index + 1, totalPages - 1));
        }
    };

    const goPrevious = async () => {
        if (currentIndex <= 0) {
            return;
        }

        const result = await currentPage.onPrevious?.(pageContext);
        if (result === false) {
            return;
        }

        setCurrentIndex((index) => Math.max(index - 1, 0));
    };

    const pageContext: WizardPageRenderContext = {
        currentIndex,
        totalPages,
        goToPage,
        goNext,
        goPrevious,
    };

    const canGoBack =
        currentIndex > 0 &&
        (typeof currentPage.canGoBack === "function"
            ? currentPage.canGoBack(pageContext)
            : (currentPage.canGoBack ?? true));

    const canGoNext =
        typeof currentPage.canGoNext === "function"
            ? currentPage.canGoNext(pageContext)
            : (currentPage.canGoNext ?? true);

    const isPageValid =
        typeof currentPage.isPageValid === "function"
            ? currentPage.isPageValid(pageContext)
            : (currentPage.isPageValid ?? true);

    const nextLabel =
        typeof currentPage.nextLabel === "function"
            ? currentPage.nextLabel(pageContext)
            : (currentPage.nextLabel ??
              (currentIndex === totalPages - 1
                  ? locConstants.common.finish
                  : locConstants.common.next));

    useEffect(() => {
        void currentPage.onEnter?.(pageContext);
    }, [currentIndex]);

    const showCancel =
        typeof currentPage.showCancel === "function"
            ? currentPage.showCancel(pageContext)
            : (currentPage.showCancel ?? true);

    const extraFooterActions =
        typeof currentPage.extraFooterActions === "function"
            ? currentPage.extraFooterActions(pageContext)
            : currentPage.extraFooterActions;

    return (
        <WizardPageShell
            icon={icon}
            title={title}
            subtitle={currentPage.title}
            currentStep={currentIndex + 1}
            totalSteps={totalPages}
            maxContentWidth={maxContentWidth}
            footerStart={
                <div className={classes.footerGroup}>
                    {showCancel && (
                        <Button appearance="secondary" onClick={onCancel}>
                            {locConstants.common.cancel}
                        </Button>
                    )}
                    {extraFooterActions}
                </div>
            }
            footerEnd={
                <div className={classes.footerGroup}>
                    {currentIndex > 0 && (
                        <Button
                            appearance="secondary"
                            disabled={!canGoBack}
                            onClick={() => void goPrevious()}>
                            <span className={classes.footerButtonContent}>
                                <ArrowLeft20Regular />
                                <span>{locConstants.common.previous}</span>
                            </span>
                        </Button>
                    )}
                    <Button
                        appearance="primary"
                        disabled={!isPageValid || !canGoNext}
                        onClick={() => void goNext()}>
                        <span className={classes.footerButtonContent}>
                            <span>{nextLabel}</span>
                            {currentIndex < totalPages - 1 && <ArrowRight20Regular />}
                        </span>
                    </Button>
                </div>
            }>
            {currentPage.render(pageContext)}
        </WizardPageShell>
    );
};
