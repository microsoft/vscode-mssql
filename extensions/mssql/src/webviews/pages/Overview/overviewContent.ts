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
    skillsRepository: "https://github.com/microsoft/azure-sql-database-container",
    // Template source links are built by appending a path to this, so it stays a real GitHub
    // URL rather than the aka.ms/vscode-mssql-devcontainers-repo alias, which cannot be extended.
    devContainersRepository: "https://github.com/microsoft/azuresql-devcontainers",
    dockerDesktop: "https://aka.ms/vscode-mssql-docker-desktop",
    copilotDocumentation: "https://aka.ms/vscode-mssql-copilot-docs",
    // Placeholder until step-specific Microsoft Learn destinations are available.
    copilotWalkthroughDocumentation: "https://learn.microsoft.com/",
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

export function getPromptCards(): PromptCard[] {
    const loc = locConstants.overview;
    return [
        {
            id: "createLocal",
            tag: loc.promptTagLocalDev,
            title: loc.promptCreateLocalTitle,
            description: loc.promptCreateLocalDescription,
            prompt: loc.promptCreateLocalBody,
        },
        {
            id: "buildApp",
            tag: loc.promptTagBuild,
            title: loc.promptBuildAppTitle,
            description: loc.promptBuildAppDescription,
            prompt: loc.promptBuildAppBody,
        },
        {
            id: "designSchema",
            tag: loc.promptTagSchema,
            title: loc.promptDesignSchemaTitle,
            description: loc.promptDesignSchemaDescription,
            prompt: loc.promptDesignSchemaBody,
        },
        {
            id: "deploy",
            tag: loc.promptTagDeploy,
            title: loc.promptDeployTitle,
            description: loc.promptDeployDescription,
            prompt: loc.promptDeployBody,
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
