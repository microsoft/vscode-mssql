/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DevContainerTemplateId } from "../../../sharedInterfaces/overview";
import { locConstants } from "../../common/locConstants";

/** External destinations linked from the Overview page. */
export const overviewLinks = {
    youTubeChannel: "https://www.youtube.com/@mssql",
    repository: "https://github.com/microsoft/vscode-mssql",
    documentation:
        "https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code",
    reportBug: "https://aka.ms/vscode-mssql-bug",
    requestFeature: "https://aka.ms/vscode-mssql-feature-request",
    discussions: "https://aka.ms/vscode-mssql-discussions",
    devHub: "https://aka.ms/azure-sql-dev-hub",
    devContainersQuickstart:
        "https://learn.microsoft.com/azure/azure-sql/database/local-dev-experience-dev-containers-quickstart",
    skillsRepository: "https://github.com/microsoft/azure-sql-skills",
    devContainersRepository: "https://github.com/microsoft/azuresql-devcontainers",
    copilotDocumentation:
        "https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/github-copilot/overview",
} as const;

/** CLI equivalent of the "Add to GitHub Copilot" button, offered for scripted setups. */
export const agentSkillsCliCommand =
    "npx skills add microsoft/azure-sql-skills -a github-copilot --skill spin-up-container " +
    "--skill provision-azure-sql-db-free-tier --skill choose-driver-by-language " +
    "--skill bootstrap-typescript-app --skill bootstrap-python-app --skill bootstrap-dotnet-app " +
    "--skill design-mssql-schema --skill ef-core-best-practices --skill prisma-mssql " +
    "--skill t-sql-json-and-openjson --skill build-rag-on-azure-sql --skill github-actions-deploy-sql";

export interface PromptCard {
    id: string;
    tag: string;
    title: string;
    description: string;
    /** Text copied to the clipboard, handed to an agent verbatim. */
    prompt: string;
    /** Source of the prompt, for users who want to read it in full first. */
    url: string;
}

export function getPromptCards(): PromptCard[] {
    const loc = locConstants.overview;
    const promptsBase = `${overviewLinks.skillsRepository}/blob/main/prompts`;
    return [
        {
            id: "createLocal",
            tag: loc.promptTagLocalDev,
            title: loc.promptCreateLocalTitle,
            description: loc.promptCreateLocalDescription,
            prompt: "Create a local Azure SQL Database container in VS Code, start it, and connect to it — then show me the connection details.",
            url: `${promptsBase}/create-local-container.md`,
        },
        {
            id: "buildApp",
            tag: loc.promptTagBuild,
            title: loc.promptBuildAppTitle,
            description: loc.promptBuildAppDescription,
            prompt: "Scaffold a .NET or Python app wired to a local Azure SQL Database container, with a working data-access layer and a sample query.",
            url: `${promptsBase}/build-app-on-azure-sql.md`,
        },
        {
            id: "designSchema",
            tag: loc.promptTagSchema,
            title: loc.promptDesignSchemaTitle,
            description: loc.promptDesignSchemaDescription,
            prompt: "Design a normalized schema for my app on Azure SQL, create the tables, and seed realistic sample data.",
            url: `${promptsBase}/design-schema.md`,
        },
        {
            id: "deploy",
            tag: loc.promptTagDeploy,
            title: loc.promptDeployTitle,
            description: loc.promptDeployDescription,
            prompt: "Provision a free-tier Azure SQL Database and deploy my app to it, migrating the local schema and sample data.",
            url: `${promptsBase}/deploy-to-azure-sql.md`,
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
            repositoryFolder: "node",
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
    channel: string;
    url: string;
}

export function getVideoCards(extensionVersion: string): VideoCard[] {
    const loc = locConstants.overview;
    return [
        {
            id: "whatsNew",
            title: loc.videoWhatsNewTitle(extensionVersion),
            channel: loc.videoChannelMssql,
            url: overviewLinks.youTubeChannel,
        },
        {
            id: "extension",
            title: loc.videoExtensionTitle,
            channel: loc.videoChannelMssql,
            url: "https://youtu.be/eIkX-ypBkko",
        },
        {
            id: "vsCodeLive",
            title: loc.videoVsCodeLiveTitle,
            channel: loc.videoChannelVsCode,
            url: "https://www.youtube.com/live/eKvejWoq80Q",
        },
    ];
}
