/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, makeStyles, mergeClasses, Text, tokens } from "@fluentui/react-components";
import { AzureSqlDatabaseIcon } from "../../../common/icons/azureSqlDatabase";
import { DockerIcon } from "../../../common/icons/docker";
import { KeyCode } from "../../../common/keys";
import { locConstants } from "../../../common/locConstants";

const useStyles = makeStyles({
    cardRow: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 360px))",
        justifyContent: "center",
        gap: "12px",
        width: "100%",
        alignItems: "stretch",
    },
    card: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        padding: "22px 24px",
        gap: "14px",
        width: "100%",
        maxWidth: "360px",
        minHeight: "220px",
        borderRadius: "18px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1,
        boxShadow: tokens.shadow4,
        boxSizing: "border-box",
        justifySelf: "center",
        cursor: "pointer",
        transitionProperty: "transform, box-shadow, border-color",
        transitionDuration: tokens.durationNormal,
        transitionTimingFunction: tokens.curveEasyEase,
        ":hover": {
            transform: "translateY(-2px)",
            boxShadow: tokens.shadow8,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
        },
    },
    selectedCard: {
        border: "1px solid var(--vscode-focusBorder)",
        boxShadow: `0 0 0 1px var(--vscode-focusBorder), ${tokens.shadow8}`,
    },
    disabledCard: {
        cursor: "default",
        opacity: 0.7,
        ":hover": {
            transform: "none",
            boxShadow: tokens.shadow4,
            border: `1px solid ${tokens.colorNeutralStroke2}`,
        },
    },
    iconBadge: {
        width: "56px",
        height: "56px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "14px",
        backgroundColor: "color-mix(in srgb, var(--vscode-focusBorder) 12%, transparent)",
        color: "var(--vscode-focusBorder)",
        flexShrink: 0,
    },
    icon: {
        width: "32px",
        height: "32px",
    },
    content: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "8px",
        width: "100%",
    },
    cardHeader: {
        fontWeight: 600,
        fontSize: "18px",
        lineHeight: "24px",
        color: tokens.colorNeutralForeground1,
    },
    cardDescription: {
        fontWeight: 400,
        fontSize: "14px",
        lineHeight: "22px",
        color: tokens.colorNeutralForeground3,
        textAlign: "left",
    },
});

interface AzureSqlDatabaseDeploymentTypePageProps {
    isFreeDeploymentLoading: boolean;
    onLocalContainerSelected: () => void;
    onFreeDeploymentSelected: () => void;
}

export const AzureSqlDatabaseDeploymentTypePage: React.FC<
    AzureSqlDatabaseDeploymentTypePageProps
> = ({ isFreeDeploymentLoading, onLocalContainerSelected, onFreeDeploymentSelected }) => {
    const classes = useStyles();

    const handleKeyDown = (event: React.KeyboardEvent, onSelect: () => void) => {
        if (event.code === KeyCode.Enter || event.code === KeyCode.Space) {
            event.preventDefault();
            onSelect();
        }
    };

    return (
        <div className={classes.cardRow}>
            <Card
                className={mergeClasses(
                    classes.card,
                    isFreeDeploymentLoading ? classes.disabledCard : undefined,
                )}
                onClick={isFreeDeploymentLoading ? undefined : onLocalContainerSelected}
                onKeyDown={
                    isFreeDeploymentLoading
                        ? undefined
                        : (event) => handleKeyDown(event, onLocalContainerSelected)
                }
                tabIndex={isFreeDeploymentLoading ? -1 : 0}
                role="button"
                aria-disabled={isFreeDeploymentLoading}>
                <div className={classes.iconBadge}>
                    <DockerIcon
                        className={classes.icon}
                        role="img"
                        aria-label={locConstants.azureSqlDatabase.localContainer}
                    />
                </div>
                <div className={classes.content}>
                    <Text className={classes.cardHeader}>
                        {locConstants.azureSqlDatabase.localContainer}
                    </Text>
                    <Text className={classes.cardDescription}>
                        {locConstants.azureSqlDatabase.localContainerDescription}
                    </Text>
                </div>
            </Card>
            <Card
                className={mergeClasses(
                    classes.card,
                    isFreeDeploymentLoading ? classes.selectedCard : undefined,
                    isFreeDeploymentLoading ? classes.disabledCard : undefined,
                )}
                onClick={isFreeDeploymentLoading ? undefined : onFreeDeploymentSelected}
                onKeyDown={
                    isFreeDeploymentLoading
                        ? undefined
                        : (event) => handleKeyDown(event, onFreeDeploymentSelected)
                }
                tabIndex={isFreeDeploymentLoading ? -1 : 0}
                role="button"
                aria-disabled={isFreeDeploymentLoading}>
                <div className={classes.iconBadge}>
                    <AzureSqlDatabaseIcon
                        className={classes.icon}
                        role="img"
                        aria-label={locConstants.azureSqlDatabase.free}
                    />
                </div>
                <div className={classes.content}>
                    <Text className={classes.cardHeader}>{locConstants.azureSqlDatabase.free}</Text>
                    <Text className={classes.cardDescription}>
                        {locConstants.azureSqlDatabase.freeDescription}
                    </Text>
                </div>
            </Card>
        </div>
    );
};
