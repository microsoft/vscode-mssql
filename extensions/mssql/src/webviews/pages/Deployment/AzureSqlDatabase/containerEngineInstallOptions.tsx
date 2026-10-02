/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Card,
    Link,
    makeStyles,
    mergeClasses,
    Text,
    tokens,
} from "@fluentui/react-components";
import { Open12Regular, Desktop20Regular } from "@fluentui/react-icons";
import { AzureSqlDatabaseLinks } from "../../../../sharedInterfaces/azureSqlDatabase";
import { CollapsibleSection } from "../../../common/collapsibleSection";
import { locConstants } from "../../../common/locConstants";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        width: "100%",
    },
    introduction: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
    },
    title: {
        fontSize: tokens.fontSizeBase400,
        lineHeight: tokens.lineHeightBase400,
        fontWeight: tokens.fontWeightSemibold,
    },
    description: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: "13px",
        lineHeight: tokens.lineHeightBase400,
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    cardStack: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    card: {
        position: "relative",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) minmax(0, auto)",
        alignItems: "center",
        gap: "12px",
        padding: "12px",
        borderRadius: "6px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: `color-mix(in srgb, ${tokens.colorNeutralBackground1} 96%, ${tokens.colorNeutralForeground1})`,
        boxShadow: "none",
        cursor: "pointer",
        ":hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
            boxShadow: tokens.shadow4,
        },
        ":active": {
            boxShadow: `inset 0 0 0 1px ${tokens.colorPaletteBlueBorderActive}`,
        },
    },
    cardIcon: {
        color: tokens.colorPaletteBlueBorderActive,
    },
    cardContent: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        minWidth: 0,
        textAlign: "left",
    },
    otherEnginesSection: {
        border: "none",
        borderRadius: 0,
    },
    otherEnginesPanel: {
        borderTop: "none",
        padding: "8px 0 0",
    },
    otherEnginesButton: {
        padding: 0,
    },
    recommendedCard: {
        maxWidth: "100%",
        border: `1px solid ${tokens.colorPaletteBlueBorderActive}`,
    },
    recommendedBadge: {
        backgroundColor: `color-mix(in srgb, ${tokens.colorPaletteBlueBackground2} 50%, var(--vscode-editorWidget-background, var(--vscode-editor-background)))`,
        color: `color-mix(in srgb, ${tokens.colorPaletteBlueForeground2} 70%, var(--vscode-descriptionForeground))`,
        border: `0.25px solid color-mix(in srgb, ${tokens.colorPaletteBlueBorderActive} 50%, ${tokens.colorNeutralStroke2})`,
        borderRadius: "2px",
        minWidth: 0,
        height: "16px",
        padding: "0 6px",
        fontSize: "10px",
        lineHeight: "14px",
        textTransform: "uppercase",
    },
    cardHeader: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "8px",
    },
    cardTitle: {
        fontSize: tokens.fontSizeBase300,
        lineHeight: tokens.lineHeightBase300,
        fontWeight: tokens.fontWeightSemibold,
    },
    cardDescription: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
    },
    link: {
        position: "static",
        display: "inline-flex",
        alignItems: "center",
        justifySelf: "end",
        alignSelf: "center",
        textAlign: "right",
        gap: "4px",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        fontWeight: tokens.fontWeightSemibold,
        color: "var(--vscode-textLink-foreground)",
        textDecorationLine: "none",
        "::after": {
            content: '""',
            position: "absolute",
            inset: 0,
            borderRadius: "6px",
        },
        ":focus-visible::after": {
            outline: "2px solid var(--vscode-focusBorder)",
            outlineOffset: "-2px",
        },
    },
});

interface EngineInstallCardProps {
    title: string;
    description: string;
    linkLabel: string;
    href: string;
    recommended?: boolean;
}

const EngineInstallCard: React.FC<EngineInstallCardProps> = ({
    title,
    description,
    linkLabel,
    href,
    recommended,
}) => {
    const classes = useStyles();
    return (
        <Card className={mergeClasses(classes.card, recommended && classes.recommendedCard)}>
            <Desktop20Regular className={classes.cardIcon} aria-hidden="true" />
            <div className={classes.cardContent}>
                <div className={classes.cardHeader}>
                    <Text className={classes.cardTitle}>{title}</Text>
                    {recommended && (
                        <Badge appearance="tint" className={classes.recommendedBadge}>
                            {locConstants.azureSqlDatabase.recommended}
                        </Badge>
                    )}
                </div>
                <Text className={classes.cardDescription}>{description}</Text>
            </div>
            <Link className={classes.link} href={href} target="_blank" rel="noopener noreferrer">
                <span>{linkLabel}</span>
                <Open12Regular aria-hidden="true" />
            </Link>
        </Card>
    );
};

export const ContainerEngineInstallOptions: React.FC = () => {
    const classes = useStyles();
    const otherEngines: EngineInstallCardProps[] = [
        {
            title: locConstants.azureSqlDatabase.podman,
            description: locConstants.azureSqlDatabase.podmanDescription,
            linkLabel: locConstants.azureSqlDatabase.getPodmanDesktop,
            href: AzureSqlDatabaseLinks.podmanDesktop,
        },
        {
            title: locConstants.azureSqlDatabase.containerd,
            description: locConstants.azureSqlDatabase.containerdDescription,
            linkLabel: locConstants.azureSqlDatabase.getRancherDesktop,
            href: AzureSqlDatabaseLinks.rancherDesktop,
        },
        {
            title: locConstants.azureSqlDatabase.appleContainer,
            description: locConstants.azureSqlDatabase.appleContainerDescription,
            linkLabel: locConstants.azureSqlDatabase.getAppleContainer,
            href: AzureSqlDatabaseLinks.appleContainer,
        },
        {
            title: locConstants.azureSqlDatabase.wslContainer,
            description: locConstants.azureSqlDatabase.wslContainerDescription,
            linkLabel: locConstants.azureSqlDatabase.setUpWslContainers,
            href: AzureSqlDatabaseLinks.wslContainers,
        },
    ];

    return (
        <div className={classes.outerDiv}>
            <div className={classes.introduction}>
                <Text className={classes.title}>
                    {locConstants.azureSqlDatabase.installContainerEngineToContinue}
                </Text>
                <Text className={classes.description}>
                    {locConstants.azureSqlDatabase.installContainerEngineDescription}
                </Text>
            </div>
            <section className={classes.section}>
                <EngineInstallCard
                    title={locConstants.azureSqlDatabase.docker}
                    description={locConstants.azureSqlDatabase.dockerDescription}
                    linkLabel={locConstants.azureSqlDatabase.getDockerDesktop}
                    href={AzureSqlDatabaseLinks.dockerDesktop}
                    recommended
                />
            </section>
            <CollapsibleSection
                title={locConstants.azureSqlDatabase.otherSupportedEngines}
                className={classes.otherEnginesSection}
                buttonClassName={classes.otherEnginesButton}
                panelClassName={classes.otherEnginesPanel}
                defaultOpen={false}>
                <div className={classes.cardStack}>
                    {otherEngines.map((engine) => (
                        <EngineInstallCard key={engine.title} {...engine} />
                    ))}
                </div>
            </CollapsibleSection>
        </div>
    );
};
