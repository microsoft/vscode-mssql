/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    makeStyles,
    Text,
    tokens,
} from "@fluentui/react-components";
import { Info20Regular } from "@fluentui/react-icons";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { locConstants } from "../../../../common/locConstants";

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
        padding: "12px",
        backgroundColor: tokens.colorNeutralBackground3,
        borderRadius: "4px",
    },
    infoIcon: {
        color: tokens.colorBrandForeground1,
        flexShrink: 0,
        marginTop: "2px",
    },
});

interface DabDeploymentConfirmationProps {
    apiTypes: Dab.ApiType[];
    onConfirm: () => void;
    onCancel: () => void;
}

const apiTypeDisplayNames: Record<Dab.ApiType, string> = {
    [Dab.ApiType.Rest]: "REST",
    [Dab.ApiType.GraphQL]: "GraphQL",
    [Dab.ApiType.Mcp]: "MCP",
};

function formatApiTypesList(apiTypes: Dab.ApiType[]): string {
    const names = apiTypes.map((t) => apiTypeDisplayNames[t]);
    if (names.length <= 1) {
        return names.join("");
    }
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

export const DabDeploymentConfirmation = ({
    apiTypes,
    onConfirm,
    onCancel,
}: DabDeploymentConfirmationProps) => {
    const classes = useStyles();

    return (
        <>
            <DialogTitle>{locConstants.schemaDesigner.deployDabContainer}</DialogTitle>
            <DialogContent className={classes.content}>
                <div className={classes.confirmationInfo}>
                    <Info20Regular className={classes.infoIcon} />
                    <div>
                        <Text weight="semibold">
                            {locConstants.schemaDesigner.localContainerDeployment}
                        </Text>
                        <Text block style={{ marginTop: "8px" }}>
                            {locConstants.schemaDesigner.deployDabContainerDescription(
                                formatApiTypesList(apiTypes),
                            )}
                        </Text>
                        <Text block style={{ marginTop: "8px" }}>
                            <strong>{locConstants.schemaDesigner.requirements}</strong>{" "}
                            {locConstants.schemaDesigner.dockerDesktopRequirement}
                        </Text>
                    </div>
                </div>
            </DialogContent>
            <DialogActions>
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
