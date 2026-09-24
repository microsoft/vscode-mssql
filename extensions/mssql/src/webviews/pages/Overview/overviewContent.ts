/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentSkillPluginName, DevContainerTemplateId } from "../../../sharedInterfaces/overview";
import { locConstants } from "../../common/locConstants";

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
    // Stand-ins until the catalog resolves: the cards then open the collection on whatever
    // repository the short link pointed at, which is also where their skills were installed
    // from. These only show while that is in flight, or when it cannot be reached.
    skillsRepository: "https://aka.ms/vscode-mssql-skills-repo",
    migrationSkillsRepository: "https://aka.ms/vscode-mssql-skills-repo",
    // Template source links are built by appending a path to this, so it stays a real GitHub
    // URL rather than the aka.ms/vscode-mssql-devcontainers-repo alias, which cannot be extended.
    devContainersRepository: "https://github.com/microsoft/azuresql-devcontainers",
    dockerDesktop: "https://aka.ms/vscode-mssql-docker-desktop",
    copilotDocumentation: "https://aka.ms/vscode-mssql-copilot-docs",
    // The alias covers the page, and its redirect carries no fragment of its own, so the
    // section anchor survives it.
    objectExplorerDocumentation: "https://aka.ms/vscode-mssql-docs#object-explorer-filtering",
    queryResultsDocumentation: "https://aka.ms/vscode-mssql-docs#query-results-pane",
} as const;

export interface PromptCard {
    id: string;
    tag: string;
    title: string;
    description: string;
    prompt: string;
}

export interface AgentSkillPack {
    id: AgentSkillPluginName;
    name: string;
    icon: "agentSkills" | "sqlMigration";
    description: string;
    repositoryUrl: string;
    prompts: PromptCard[];
}

export function getAgentSkillPacks(): AgentSkillPack[] {
    const loc = locConstants.overview;
    return [
        {
            id: "microsoft-sql-vscode",
            name: loc.agentSkillsName,
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
            id: "microsoft-sql-migration",
            name: loc.migrationSkillsName,
            icon: "sqlMigration",
            description: loc.migrationSkillsDescription,
            repositoryUrl: overviewLinks.migrationSkillsRepository,
            prompts: [
                {
                    id: "assessMigration",
                    tag: loc.promptTagAssess,
                    title: loc.promptAssessMigrationTitle,
                    description: loc.promptAssessMigrationDescription,
                    prompt: loc.promptAssessMigrationBody,
                },
                {
                    id: "planMigration",
                    tag: loc.promptTagPlan,
                    title: loc.promptPlanMigrationTitle,
                    description: loc.promptPlanMigrationDescription,
                    prompt: loc.promptPlanMigrationBody,
                },
                {
                    id: "migrateDatabase",
                    tag: loc.promptTagMigrate,
                    title: loc.promptMigrateDatabaseTitle,
                    description: loc.promptMigrateDatabaseDescription,
                    prompt: loc.promptMigrateDatabaseBody,
                },
                {
                    id: "validateMigration",
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
    subtitle: string;
    repositoryFolder: string;
}

export function getDevContainerTemplates(): DevContainerTemplate[] {
    const loc = locConstants.overview;
    return [
        {
            id: DevContainerTemplateId.DotNet,
            name: loc.devContainerDotNet,
            subtitle: loc.devContainerDotNetSubtitle,
            repositoryFolder: "dotnet",
        },
        {
            id: DevContainerTemplateId.DotNetAspire,
            name: loc.devContainerDotNetAspire,
            subtitle: loc.devContainerDotNetAspireSubtitle,
            repositoryFolder: "dotnet-aspire",
        },
        {
            id: DevContainerTemplateId.Node,
            name: loc.devContainerNode,
            subtitle: loc.devContainerNodeSubtitle,
            repositoryFolder: "javascript-node",
        },
        {
            id: DevContainerTemplateId.Python,
            name: loc.devContainerPython,
            subtitle: loc.devContainerPythonSubtitle,
            repositoryFolder: "python",
        },
    ];
}

export function getTemplateSourceUrl(template: DevContainerTemplate): string {
    return `${overviewLinks.devContainersRepository}/tree/main/src/${template.repositoryFolder}`;
}

export interface VideoCard {
    id: string;
    title: string;
    subtitle: string;
    thumbnail: "whatsNew" | "gettingStarted" | "aiReadyApp";
    url: string;
}

export function getVideoCards(): VideoCard[] {
    const loc = locConstants.overview;
    return [
        {
            id: "whatsNew",
            title: loc.videoWhatsNewTitle,
            subtitle: loc.videoWhatsNewSubtitle,
            thumbnail: "whatsNew",
            url: overviewLinks.landingPageVideo1,
        },
        {
            id: "gettingStarted",
            title: loc.videoGettingStartedTitle,
            subtitle: loc.videoGettingStartedSubtitle,
            thumbnail: "gettingStarted",
            url: overviewLinks.landingPageVideo2,
        },
        {
            id: "aiReadyApp",
            title: loc.videoVsCodeLiveTitle,
            subtitle: loc.videoVsCodeLiveSubtitle,
            thumbnail: "aiReadyApp",
            url: overviewLinks.landingPageVideo3,
        },
    ];
}
