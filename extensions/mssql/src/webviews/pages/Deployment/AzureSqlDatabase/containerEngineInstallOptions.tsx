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
import { ArrowRight12Regular } from "@fluentui/react-icons";
import { AzureSqlDatabaseLinks } from "../../../../sharedInterfaces/azureSqlDatabase";
import { CollapsibleSection } from "../../../common/collapsibleSection";
import { locConstants } from "../../../common/locConstants";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        width: "100%",
    },
    introduction: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    title: {
        fontSize: tokens.fontSizeBase500,
        lineHeight: tokens.lineHeightBase500,
        fontWeight: tokens.fontWeightSemibold,
    },
    description: {
        color: tokens.colorNeutralForeground3,
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
        gap: "12px",
    },
    card: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "10px",
        padding: "16px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1Hover,
        boxShadow: "none",
    },
    recommendedCard: {
        maxWidth: "100%",
    },
    cardHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    cardTitle: {
        fontSize: tokens.fontSizeBase400,
        lineHeight: tokens.lineHeightBase400,
        fontWeight: tokens.fontWeightSemibold,
    },
    cardDescription: {
        color: tokens.colorNeutralForeground3,
        lineHeight: tokens.lineHeightBase400,
    },
    link: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        textDecorationLine: "none",
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
            <div className={classes.cardHeader}>
                <Text className={classes.cardTitle}>{title}</Text>
                {recommended && (
                    <Badge appearance="tint" color="brand">
                        {locConstants.azureSqlDatabase.recommended}
                    </Badge>
                )}
            </div>
            <Text className={classes.cardDescription}>{description}</Text>
            <Link className={classes.link} href={href} target="_blank" rel="noopener noreferrer">
                <span>{linkLabel}</span>
                <ArrowRight12Regular />
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
