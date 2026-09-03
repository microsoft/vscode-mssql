/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, DialogActions, makeStyles, Text, tokens } from "@fluentui/react-components";
import { Info20Regular } from "@fluentui/react-icons";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { locConstants } from "../../../../common/locConstants";
import { DabDialogContent, DabDialogTitle } from "./dabDialogLayout";

const useStyles = makeStyles({
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
    },
    confirmationInfo: {
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "16px",
        backgroundColor: tokens.colorNeutralBackground3,
        borderRadius: "6px",
        // Body copy sits at the readable size and contrast rather than the
        // muted small text this box used to carry.
        fontSize: tokens.fontSizeBase300,
        lineHeight: tokens.lineHeightBase300,
        color: tokens.colorNeutralForeground1,
    },
    infoIcon: {
        color: tokens.colorBrandForeground1,
        flexShrink: 0,
        marginTop: "2px",
    },
});

interface DabDeploymentConfirmationProps {
    apiTypes: Dab.ApiType[];
    target: Dab.DabDeploymentTarget;
    onConfirm: () => void;
    /** Omitted when nothing precedes this step. */
    onBack?: () => void;
    onCancel: () => void;
}

const apiTypeDisplayNames: Record<Dab.ApiType, string> = {
    [Dab.ApiType.Rest]: "REST",
    [Dab.ApiType.GraphQL]: "GraphQL",
    [Dab.ApiType.Mcp]: "MCP",
};

function formatApiTypesList(apiTypes: Dab.ApiType[]): string {
    const names = apiTypes.map((t) => apiTypeDisplayNames[t]);
    return new Intl.ListFormat(undefined, { style: "long", type: "conjunction" }).format(names);
}

export const DabWizardConfirmation = ({
    apiTypes,
    target,
    onConfirm,
    onBack,
    onCancel,
}: DabDeploymentConfirmationProps) => {
    const classes = useStyles();
    const isCli = target === Dab.DabDeploymentTarget.DabCli;

    return (
        <>
            <DabDialogTitle>
                {isCli
                    ? locConstants.schemaDesigner.deployDabCli
                    : locConstants.schemaDesigner.deployDabContainer}
            </DabDialogTitle>
            <DabDialogContent>
                <div className={classes.confirmationInfo}>
                    <Info20Regular className={classes.infoIcon} />
                    <div>
                        <Text weight="semibold">
                            {isCli
                                ? locConstants.schemaDesigner.deploymentTargetDabCli
                                : locConstants.schemaDesigner.localContainerDeployment}
                        </Text>
                        <Text block style={{ marginTop: "8px" }}>
                            {isCli
                                ? locConstants.schemaDesigner.deployDabCliDescription(
                                      formatApiTypesList(apiTypes),
                                  )
                                : locConstants.schemaDesigner.deployDabContainerDescription(
                                      formatApiTypesList(apiTypes),
                                  )}
                        </Text>
                        <Text block style={{ marginTop: "8px" }}>
                            <strong>{locConstants.schemaDesigner.requirements}</strong>{" "}
                            {isCli
                                ? locConstants.schemaDesigner.dotnetRequirement
                                : locConstants.schemaDesigner.dockerDesktopRequirement}
                        </Text>
                    </div>
                </div>
            </DabDialogContent>
            <DialogActions>
                {onBack && (
                    <Button appearance="secondary" onClick={onBack}>
                        {locConstants.common.back}
                    </Button>
                )}
                <Button appearance="secondary" onClick={onCancel}>
                    {locConstants.common.cancel}
                </Button>
                <Button appearance="primary" onClick={onConfirm}>
                    {locConstants.common.next}
                </Button>
            </DialogActions>
        </>
    );
};
