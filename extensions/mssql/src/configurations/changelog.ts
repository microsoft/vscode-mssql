/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangelogWebviewState } from "../sharedInterfaces/changelog";
import * as vscode from "vscode";
import * as constants from "../constants/constants";
import * as locConstants from "../constants/locConstants";

export const changelogConfig: ChangelogWebviewState = {
    mainContent: {
        title: locConstants.Changelog.mainContentTitle,
        entries: [
            {
                title: locConstants.Changelog.schemaDesignerCopilotTitle,
                isPreview: true,
                description: locConstants.Changelog.schemaDesignerCopilotDescription,
                actions: [
                    {
                        label: locConstants.Changelog.learnMore,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-schema-designer-copilot-docs",
                    },
                ],
            },
            {
                title: locConstants.Changelog.dabTitle,
                isPreview: true,
                description: locConstants.Changelog.dabDescription,
                actions: [
                    {
                        label: locConstants.Changelog.learnMore,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-dab-docs",
                    },
                ],
            },
            {
                title: locConstants.Changelog.dabCopilotTitle,
                isPreview: true,
                description: locConstants.Changelog.dabCopilotDescription,
                actions: [
                    {
                        label: locConstants.Changelog.learnMore,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-dab-copilot",
                    },
                ],
            },
            {
                title: locConstants.Changelog.sqlNotebooksTitle,
                isPreview: true,
                description: locConstants.Changelog.sqlNotebooksDescription,
                actions: [
                    {
                        label: locConstants.Changelog.tryIt,
                        type: "command",
                        value: constants.cmdNotebooksCreate,
                    },
                    {
                        label: locConstants.Changelog.learnMore,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-sql-notebooks",
                    },
                ],
            },
            {
                title: locConstants.Changelog.fabricQueryProfilerTitle,
                description: locConstants.Changelog.fabricQueryProfilerDescription,
                codeSnippets: ["TSQL_Azure"],
                actions: [
                    {
                        label: locConstants.Changelog.learnMore,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-query-profiler-docs#create-a-profiling-session",
                    },
                ],
            },
            {
                title: locConstants.Changelog.adsMigrationTitle,
                description: locConstants.Changelog.adsMigrationDescription,
                icon: "azureDataStudio.svg",
                actions: [
                    {
                        label: locConstants.Changelog.tryIt,
                        type: "command",
                        value: constants.cmdOpenAzureDataStudioMigration,
                    },
                    {
                        label: locConstants.Changelog.watchDemo,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-ads-migration-demo",
                    },
                    {
                        label: locConstants.Changelog.learnMore,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-ads-migration",
                    },
                ],
            },
        ],
    },
    secondaryContent: {
        title: locConstants.Changelog.secondaryContentTitle,
        description: locConstants.Changelog.secondaryContentDescription,
        entries: [
            {
                title: locConstants.Changelog.editDataTitle,
                description: locConstants.Changelog.editDataDescription,
                actions: [
                    {
                        label: locConstants.Changelog.watchDemo,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-edit-data-demo",
                    },
                    {
                        label: locConstants.Changelog.learnMore,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-edit-data",
                    },
                ],
            },
            {
                title: locConstants.Changelog.dacpacTitle,
                description: locConstants.Changelog.dacpacDescription,
                actions: [
                    {
                        label: locConstants.Changelog.tryIt,
                        type: "command",
                        value: constants.cmdDacpacDialog,
                    },
                    {
                        label: locConstants.Changelog.watchDemo,
                        type: "link",
                        value: "https://youtu.be/JhyBSthgFys?si=Koe1HSYZXJxfVHZY&t=736",
                    },
                    {
                        label: locConstants.Changelog.learnMore,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-dacpac",
                    },
                ],
            },
            {
                title: locConstants.Changelog.fabricIntegrationTitle,
                description: locConstants.Changelog.fabricIntegrationDescription,
                actions: [
                    {
                        label: locConstants.Changelog.watchDemo,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-fabric-db-demo",
                    },
                    {
                        label: locConstants.Changelog.learnMore,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-fabric-docs",
                    },
                ],
            },
            {
                title: locConstants.Changelog.sqlProjCodeAnalysisTitle,
                description: locConstants.Changelog.sqlProjCodeAnalysisDescription,
                actions: [
                    {
                        label: locConstants.Changelog.watchDemo,
                        type: "link",
                        value: "https://youtu.be/UEW9DQX8FlA",
                    },
                ],
            },
        ],
    },
    sidebarContent: [
        {
            title: locConstants.Changelog.resourcesTitle,
            description: locConstants.Changelog.resourcesDescription,
            actions: [
                {
                    type: "link",
                    label: locConstants.Changelog.watchDemosOnYoutube,
                    value: "https://aka.ms/vscode-mssql-demos",
                    icon: "VideoClip16Filled",
                },
                {
                    type: "link",
                    label: locConstants.Changelog.viewRoadmap,
                    value: "https://aka.ms/vscode-mssql-roadmap",
                },
                {
                    type: "link",
                    label: locConstants.Changelog.readTheDocumentation,
                    value: "https://aka.ms/vscode-mssql-docs",
                    icon: "BookOpen16Filled",
                },
            ],
        },
        {
            title: locConstants.Changelog.feedbackTitle,
            description: locConstants.Changelog.feedbackDescription,
            actions: [
                {
                    type: "link",
                    label: locConstants.Changelog.openNewBug,
                    value: "https://aka.ms/vscode-mssql-bug",
                    icon: "Bug16Regular",
                },
                {
                    type: "link",
                    label: locConstants.Changelog.requestNewFeature,
                    value: "https://aka.ms/vscode-mssql-feature-request",
                    icon: "Lightbulb16Regular",
                },
                {
                    type: "link",
                    label: locConstants.Changelog.joinTheDiscussions,
                    value: "https://aka.ms/vscode-mssql-discussions",
                    icon: "Chat16Regular",
                },
                {
                    type: "link",
                    label: locConstants.Changelog.copilotSurvey,
                    value: "https://aka.ms/vscode-mssql-copilot-survey",
                    icon: "ClipboardBulletList16Regular",
                },
            ],
        },
        {
            title: locConstants.Changelog.gettingStartedTitle,
            description: locConstants.Changelog.gettingStartedDescription,
            actions: [
                {
                    type: "walkthrough",
                    label: locConstants.Changelog.mssqlWalkthrough,
                    value: `${constants.extensionId}#mssql.getStarted`,
                },
                {
                    type: "walkthrough",
                    label: locConstants.Changelog.copilotWalkthrough,
                    value: `GitHub.copilot-chat#copilotWelcome`,
                },
                {
                    type: "link",
                    label: locConstants.Changelog.customizeKeyboardShortcuts,
                    value: "https://aka.ms/vscode-mssql-keyboard-shortcuts",
                },
            ],
        },
    ],
    version: vscode.extensions.getExtension(constants.extensionId).packageJSON.version || "unknown",
};
