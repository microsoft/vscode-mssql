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
    landingPageVideo2: "https://aka.ms/vscode-mssq-landing-page-video2",
    landingPageVideo3: "https://aka.ms/vscode-mssql-landing-page-video3",
    repository: "https://github.com/microsoft/vscode-mssql",
    documentation:
        "https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code",
    reportBug: "https://aka.ms/vscode-mssql-bug",
    requestFeature: "https://aka.ms/vscode-mssql-feature-request",
    discussions: "https://aka.ms/vscode-mssql-discussions",
    devHub: "https://aka.ms/azure-sql-dev-hub",
    devContainersQuickstart:
        "https://learn.microsoft.com/azure/azure-sql/database/local-dev-experience-dev-containers-quickstart",
    skillsRepository: "https://github.com/microsoft/azure-sql-database-container",
    devContainersRepository: "https://github.com/microsoft/azuresql-devcontainers",
    dockerDesktop: "https://www.docker.com/products/docker-desktop/",
    copilotDocumentation:
        "https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/github-copilot/overview",
    // Placeholder until step-specific Microsoft Learn destinations are available.
    copilotWalkthroughDocumentation: "https://learn.microsoft.com/",
    keymapExtension:
        "https://marketplace.visualstudio.com/items?itemName=ms-mssql.mssql-database-management-keymap",
} as const;

export interface PromptCard {
    id: string;
    tag: string;
    title: string;
    description: string;
    /** Text copied to the clipboard, handed to an agent verbatim. */
    prompt: string;
}

export function getPromptCards(): PromptCard[] {
    const loc = locConstants.overview;
    return [
        {
            id: "createLocal",
            tag: loc.promptTagLocalDev,
            title: loc.promptCreateLocalTitle,
            description: loc.promptCreateLocalDescription,
            prompt: "Add a local Azure SQL database to this app. Spin up the container, create an appdb database I can query, verify the first query, and point the app's configuration at it.",
        },
        {
            id: "buildApp",
            tag: loc.promptTagBuild,
            title: loc.promptBuildAppTitle,
            description: loc.promptBuildAppDescription,
            prompt: "Build me an app on Azure SQL Database. Give me the order of operations from an empty project to the first successful request that reads a row, scaffold the data access layer, and do it without putting a database password in the repo.",
        },
        {
            id: "designSchema",
            tag: loc.promptTagSchema,
            title: loc.promptDesignSchemaTitle,
            description: loc.promptDesignSchemaDescription,
            prompt: "Model these entities as tables on Azure SQL Database, then review the schema before it goes to production: call out the keys, indexes, collation and identity choices that will cause trouble later, and seed realistic sample data.",
        },
        {
            id: "deploy",
            tag: loc.promptTagDeploy,
            title: loc.promptDeployTitle,
            description: loc.promptDeployDescription,
            prompt: "Move this app from the local Azure SQL container to Azure SQL Database. Get it into Azure without putting a database password anywhere, keep the application code unchanged where possible, and tell me exactly what has to change in configuration.",
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
