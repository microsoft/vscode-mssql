/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DevContainerTemplateId } from "../../../sharedInterfaces/overview";
import { locConstants } from "../../common/locConstants";

/** External destinations linked from the Overview page. */
export const overviewLinks = {
    youTubeChannel: "https://aka.ms/vscode-mssql-demos",
    landingPageVideo1: "https://aka.ms/vscode-mssql-landing-page-video1",
    landingPageVideo2: "https://aka.ms/vscode-mssql-landing-page-video2",
    landingPageVideo3: "https://aka.ms/vscode-mssql-landing-page-video3",
    repository: "https://aka.ms/vscode-mssql-repo",
    roadmap: "https://aka.ms/vscode-mssql-roadmap",
    documentation: "https://aka.ms/vscode-mssql-docs",
    reportBug: "https://aka.ms/vscode-mssql-bug",
    requestFeature: "https://aka.ms/vscode-mssql-feature-request",
    discussions: "https://aka.ms/vscode-mssql-discussions",
    devHub: "https://aka.ms/azuresql-hub",
    devContainersQuickstart: "https://aka.ms/vscode-mssql-devcontainers-quickstart",
    // Placeholder repositories. Both skill packs are published from the Database Systems
    // AgentSkills repository, which is not public yet, so the card links, the install and
    // the skills list all point at this sample collection until that repository ships.
    skillsRepository: "https://github.com/microsoft/azure-sql-database-container",
    migrationSkillsRepository: "https://github.com/microsoft/azure-sql-database-container",
    // Template source links are built by appending a path to this, so it stays a real GitHub
    // URL rather than the aka.ms/vscode-mssql-devcontainers-repo alias, which cannot be extended.
    devContainersRepository: "https://github.com/microsoft/azuresql-devcontainers",
    dockerDesktop: "https://aka.ms/vscode-mssql-docker-desktop",
    copilotDocumentation: "https://aka.ms/vscode-mssql-copilot-docs",
    // The alias covers the page, and its redirect carries no fragment of its own, so the
    // section anchor survives it. Both the alias target and the anchor were checked against
    // the live page, which is the failure the edit-data link ran into.
    objectExplorerDocumentation: "https://aka.ms/vscode-mssql-docs#object-explorer-filtering",
    queryResultsDocumentation: "https://aka.ms/vscode-mssql-docs#query-results-pane",
    keymapExtension: "https://aka.ms/vscode-mssql-keymap",
} as const;

export interface PromptCard {
    id: string;
    tag: string;
    title: string;
    description: string;
    /** Text copied to the clipboard, handed to an agent verbatim. */
    prompt: string;
}

/** A published collection of agent skills, shown as one card on the Build tab. */
export interface AgentSkillPack {
    id: string;
    name: string;
    /**
     * Number of skills the plugin bundles, from its definition. Only used when the live catalog
     * cannot be reached, so an offline page still says something rather than nothing.
     */
    skillCount: number;
    /** Glyph shown in the card's tile; the panel maps it to a component. */
    icon: "agentSkills" | "sqlMigration";
    description: string;
    /** Source repository, opened from the card. */
    repositoryUrl: string;
    /** Starter prompts the pack's skills answer well. */
    prompts: PromptCard[];
}

export function getAgentSkillPacks(): AgentSkillPack[] {
    const loc = locConstants.overview;
    return [
        {
            id: "azure-sql",
            name: loc.agentSkillsName,
            skillCount: 57,
            icon: "agentSkills",
            description: loc.agentSkillsDescription,
            repositoryUrl: overviewLinks.skillsRepository,
            prompts: [
                {
                    id: "connectNodePasswordless",
                    tag: loc.promptTagConnect,
                    title: loc.promptConnectNodeTitle,
                    description: loc.promptConnectNodeDescription,
                    prompt: loc.promptConnectNodeBody,
                },
                {
                    id: "scaffoldAppDataLayer",
                    tag: loc.promptTagBuild,
                    title: loc.promptScaffoldAppTitle,
                    description: loc.promptScaffoldAppDescription,
                    prompt: loc.promptScaffoldAppBody,
                },
                {
                    id: "addVectorSearch",
                    tag: loc.promptTagAi,
                    title: loc.promptVectorSearchTitle,
                    description: loc.promptVectorSearchDescription,
                    prompt: loc.promptVectorSearchBody,
                },
                {
                    id: "diagnose40613",
                    tag: loc.promptTagDiagnose,
                    title: loc.promptError40613Title,
                    description: loc.promptError40613Description,
                    prompt: loc.promptError40613Body,
                },
            ],
        },
        {
            id: "sql-migration",
            name: loc.migrationSkillsName,
            skillCount: 12,
            icon: "sqlMigration",
            description: loc.migrationSkillsDescription,
            repositoryUrl: overviewLinks.migrationSkillsRepository,
            prompts: [
                {
                    id: "recommendMigrationPath",
                    tag: loc.promptTagAssess,
                    title: loc.promptMigrationPathTitle,
                    description: loc.promptMigrationPathDescription,
                    prompt: loc.promptMigrationPathBody,
                },
                {
                    id: "migrationPrerequisites",
                    tag: loc.promptTagPlan,
                    title: loc.promptMigrationPrerequisitesTitle,
                    description: loc.promptMigrationPrerequisitesDescription,
                    prompt: loc.promptMigrationPrerequisitesBody,
                },
                {
                    id: "sizeAzureSqlSku",
                    tag: loc.promptTagSize,
                    title: loc.promptSkuSizingTitle,
                    description: loc.promptSkuSizingDescription,
                    prompt: loc.promptSkuSizingBody,
                },
                {
                    id: "validatePostMigration",
                    tag: loc.promptTagValidate,
                    title: loc.promptValidateMigrationTitle,
                    description: loc.promptValidateMigrationDescription,
                    prompt: loc.promptValidateMigrationBody,
                },
            ],
        },
    ];
}

export interface DevContainerTemplate {
    id: DevContainerTemplateId;
    name: string;
    /** Folder under the azuresql-devcontainers repository that holds the template. */
    repositoryFolder: string;
}

export function getDevContainerTemplates(): DevContainerTemplate[] {
    const loc = locConstants.overview;
    return [
        {
            id: DevContainerTemplateId.DotNet,
            name: loc.devContainerDotNet,
            repositoryFolder: "dotnet",
        },
        {
            id: DevContainerTemplateId.DotNetAspire,
            name: loc.devContainerDotNetAspire,
            repositoryFolder: "dotnet-aspire",
        },
        {
            id: DevContainerTemplateId.Node,
            name: loc.devContainerNode,
            repositoryFolder: "javascript-node",
        },
        {
            id: DevContainerTemplateId.Python,
            name: loc.devContainerPython,
            repositoryFolder: "python",
        },
    ];
}

/** URL of a template's source on GitHub. */
export function getTemplateSourceUrl(template: DevContainerTemplate): string {
    return `${overviewLinks.devContainersRepository}/tree/main/src/${template.repositoryFolder}`;
}

export interface VideoCard {
    id: string;
    title: string;
    subtitle: string;
    thumbnail: "copilotSql" | "whatsNew" | "aiReadyApp";
    duration: string;
    url: string;
}

export function getVideoCards(): VideoCard[] {
    const loc = locConstants.overview;
    return [
        {
            id: "copilotSql",
            title: loc.videoDataExposedTitle,
            subtitle: loc.videoDataExposedSubtitle,
            thumbnail: "copilotSql",
            duration: "12:18",
            url: overviewLinks.landingPageVideo1,
        },
        {
            id: "whatsNew",
            title: loc.videoWhatsNewTitle,
            subtitle: loc.videoWhatsNewSubtitle,
            thumbnail: "whatsNew",
            duration: "21:58",
            url: overviewLinks.landingPageVideo2,
        },
        {
            id: "aiReadyApp",
            title: loc.videoVsCodeLiveTitle,
            subtitle: loc.videoVsCodeLiveSubtitle,
            thumbnail: "aiReadyApp",
            duration: "1:20:17",
            url: overviewLinks.landingPageVideo3,
        },
    ];
}
