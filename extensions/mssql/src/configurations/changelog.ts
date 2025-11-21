/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangelogWebviewState } from "../sharedInterfaces/changelog";
import * as vscode from "vscode";
import * as constants from "../constants/constants";
import * as locConstants from "../constants/locConstants";

export const changelogConfig: ChangelogWebviewState = {
  changes: [
    {
      title: "GitHub Copilot integration (GA)",
      description:
        "Al-assisted SQL development with schema-aware query generation, ORM support, and natural language chat with {code-snippet-0} in Ask or Agent Mode.",
      codeSnippets: ["@mssql"],
      actions: [
        {
          label: locConstants.Changelog.tryIt,
          type: "command",
          value: constants.cmdOpenGithubChat,
          args: [`@${constants.mssqlChatParticipantName} Hello!`],
        },
        {
          label: locConstants.Changelog.readDocs,
          type: "link",
          value: "https://aka.ms/vscode-mssql-copilot",
        },
      ],
    },
    {
      title: "Edit data",
      description:
        "View, edit, add, and delete table rows in an interactive grid with real-time validation and live DML script previews.",
      actions: [
        {
          label: locConstants.Changelog.readDocs,
          type: "link",
          value: "https://aka.ms/vscode-mssql-edit-data",
        },
      ],
    },
    {
      title: "DACPAC/BACPAC import and export",
      description:
        "Deploy and extract {code-snippet-0} files or import/export {code-snippet-1} packages using an integrated, streamlined workflow in VS Code.",
      codeSnippets: [".dacpac", ".bacpac"],
      actions: [
        {
          label: locConstants.Changelog.readDocs,
          type: "link",
          value: "https://aka.ms/vscode-mssql-dacpac",
        },
      ],
    },
  ],
  resources: [
    {
      label: locConstants.Changelog.watchDemosOnYoutube,
      url: "https://aka.ms/vscode-mssql-demos",
    },
    {
      label: locConstants.Changelog.viewRoadmap,
      url: "https://aka.ms/vscode-mssql-roadmap",
    },
    {
      label: locConstants.Changelog.readTheDocumentation,
      url: "https://aka.ms/vscode-mssql-docs",
    },
    {
      label: locConstants.Changelog.joinTheDiscussions,
      url: "https://aka.ms/vscode-mssql-discussions",
    },
  ],
  walkthroughs: [
    {
      label: "MSSQL - VS Code walkthrough",
      walkthroughId: `${constants.extensionId}#mssql.getStarted`,
    },
    {
      label: "GitHub Copilot - VS Code walkthrough",
      walkthroughId: `GitHub.copilot-chat#copilotWelcome`,
    },
    {
      label: locConstants.Changelog.customizeKeyboardShortcuts,
      url: "https://aka.ms/vscode-mssql-keyboard-shortcuts",
    },
  ],
  version:
    vscode.extensions.getExtension(constants.extensionId).packageJSON.version ||
    "unknown",
};
