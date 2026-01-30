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
                        value: "https://aka.ms/vscode-mssql-january2026",
                    },
                ],
            },
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
                        value: "https://aka.ms/vscode-mssql-dacpac-demo",
                    },
                    {
                        label: locConstants.Changelog.learnMore,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-dacpac-docs",
                    },
                ],
            },
            {
                title: locConstants.Changelog.sqlProjPublishTitle,
                description: locConstants.Changelog.sqlProjPublishDescription,
                actions: [
                    {
                        label: locConstants.Changelog.watchDemo,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-sqlproj-publish-demo",
                    },
                    {
                        label: locConstants.Changelog.learnMore,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-sqlproj-publish-docs",
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
                title: locConstants.Changelog.schemaDesignerTitle,
                description: locConstants.Changelog.schemaDesignerDescription,
                actions: [
                    {
                        label: locConstants.Changelog.watchDemo,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-schema-designer-demo",
                    },
                    {
                        label: locConstants.Changelog.learnMore,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-schema-designer",
                    },
                ],
            },
            {
                title: locConstants.Changelog.schemaCompareTitle,
                description: locConstants.Changelog.schemaCompareDescription,
                actions: [
                    {
                        label: locConstants.Changelog.tryIt,
                        type: "command",
                        value: constants.cmdSchemaCompareOpenFromCommandPalette,
                    },
                    {
                        label: locConstants.Changelog.watchDemo,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-schema-compare-demo",
                    },
                    {
                        label: locConstants.Changelog.learnMore,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-docs/schema-compare",
                    },
                ],
            },
            {
                title: locConstants.Changelog.localContainerTitle,
                description: locConstants.Changelog.localContainerDescription,
                actions: [
                    {
                        label: locConstants.Changelog.tryIt,
                        type: "command",
                        value: constants.cmdDeployNewDatabase,
                    },
                    {
                        label: locConstants.Changelog.watchDemo,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-container-demo",
                    },
                    {
                        label: locConstants.Changelog.learnMore,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-containers",
                    },
                ],
            },
            {
                title: locConstants.Changelog.copilotIntegrationTitle,
                description: locConstants.Changelog.copilotIntegrationDescription,
                actions: [
                    {
                        label: locConstants.Changelog.tryIt,
                        type: "command",
                        value: constants.cmdOpenGithubChat,
                        args: [`@${constants.mssqlChatParticipantName} Hello!`],
                    },
                    {
                        label: locConstants.Changelog.watchDemo,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-copilot-demo",
                    },
                    {
                        label: locConstants.Changelog.learnMore,
                        type: "link",
                        value: "https://aka.ms/vscode-mssql-november2025",
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
