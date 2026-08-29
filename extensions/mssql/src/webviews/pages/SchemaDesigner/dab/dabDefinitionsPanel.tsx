/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Spinner, makeStyles, tokens } from "@fluentui/react-components";
import {
    ErrorCircle12Regular,
    ErrorCircle16Regular,
    Warning16Regular,
} from "@fluentui/react-icons";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
    DefinitionPanel,
    DefinitionPanelController,
    DesignerDefinitionTabs,
} from "../../../common/definitionPanel";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { Dab } from "../../../../sharedInterfaces/dab";
import { useDabContext } from "./dabContext";
import { DabValidationPanel } from "./dabValidationPanel";
import { locConstants } from "../../../common/locConstants";

const validationTabId = "validation" as const;
type DabDefinitionTab = typeof DesignerDefinitionTabs.Script | typeof validationTabId;

const useStyles = makeStyles({
    tabLabel: {
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
    },
    counts: {
        display: "inline-flex",
        alignItems: "center",
        gap: "14px",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        color: tokens.colorNeutralForeground2,
    },
    count: {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        whiteSpace: "nowrap",
    },
    errorIcon: {
        color: tokens.colorPaletteRedForeground1,
    },
    warningIcon: {
        color: tokens.colorPaletteYellowForeground2,
    },
});

export interface DabDefinitionsPanelRef {
    openPanel: (tab?: DabDefinitionTab) => void;
}

export const DabDefinitionsPanel = forwardRef<DabDefinitionsPanelRef, {}>((_, ref) => {
    const context = useDabContext();
    const classes = useStyles();
    const { themeKind } = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();
    const definitionPaneRef = useRef<DefinitionPanelController>(null);
    const [activeTab, setActiveTab] = useState<DabDefinitionTab>(DesignerDefinitionTabs.Script);
    const [isPanelVisible, setIsPanelVisible] = useState(false);
    const errorCount = context.dabValidationState.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
    ).length;
    const warningCount = context.dabValidationState.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "warning",
    ).length;

    useImperativeHandle(
        ref,
        () => ({
            openPanel: (tab = DesignerDefinitionTabs.Script) => {
                setActiveTab(tab);
                definitionPaneRef.current?.openPanel();
            },
        }),
        [],
    );

    return (
        <DefinitionPanel
            ref={definitionPaneRef}
            scriptTab={{
                value: context.dabConfigTextFileContent,
                language: "json",
                themeKind,
                addToWorkspace: context.addDabConfigToWorkspace,
                openInEditor: context.openDabConfigInEditor,
                copyToClipboard: (text: string) =>
                    context.copyToClipboard(text, Dab.CopyTextType.Config),
            }}
            customTabs={[
                {
                    id: validationTabId,
                    label: (
                        <span className={classes.tabLabel}>
                            {locConstants.schemaDesigner.dabValidation}
                            {isPanelVisible &&
                                context.dabValidationState.status === "validating" && (
                                    <Spinner size="extra-tiny" />
                                )}
                            {context.dabValidationState.status === "blocked" && (
                                <ErrorCircle12Regular />
                            )}
                        </span>
                    ),
                    content: <DabValidationPanel />,
                    headerActions: (
                        <span className={classes.counts}>
                            <span className={classes.count}>
                                <ErrorCircle16Regular
                                    className={classes.errorIcon}
                                    aria-hidden="true"
                                />
                                {locConstants.schemaDesigner.dabErrorCount(errorCount)}
                            </span>
                            <span className={classes.count}>
                                <Warning16Regular
                                    className={classes.warningIcon}
                                    aria-hidden="true"
                                />
                                {locConstants.schemaDesigner.dabWarningCount(warningCount)}
                            </span>
                        </span>
                    ),
                },
            ]}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onPanelVisibilityChange={setIsPanelVisible}
        />
    );
});
