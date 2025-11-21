/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Changelog } from "../constants/locConstants";
import {
  ChangelogCommandRequest,
  ChangelogCommandRequestParams,
  ChangelogDontShowAgainRequest,
  ChangelogLinkRequest,
  ChangelogLinkRequestParams,
  ChangelogWebviewState,
  CloseChangelogRequest,
} from "../sharedInterfaces/changelog";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import * as vscode from "vscode";
import VscodeWrapper from "./vscodeWrapper";
import { changelogConfig } from "../configurations/changelog";
import * as constants from "../constants/constants";
import { sendActionEvent } from "../telemetry/telemetry";
import {
  TelemetryActions,
  TelemetryViews,
} from "../sharedInterfaces/telemetry";

const GLOBAL_STATE_LAST_CHANGELOG_VERSION_KEY =
  "changelog/lastChangeLogVersion";

export class ChangelogWebviewController extends ReactWebviewPanelController<
  ChangelogWebviewState,
  void,
  void
> {
  constructor(
    context: vscode.ExtensionContext,
    vscodeWrapper: VscodeWrapper,
    initialState: ChangelogWebviewState = changelogConfig,
  ) {
    super(context, vscodeWrapper, "changelog", "changelog", initialState, {
      title: Changelog.ChangelogDocumentTitle,
      viewColumn: vscode.ViewColumn.Active,
      iconPath: {
        dark: vscode.Uri.joinPath(
          context.extensionUri,
          "media",
          "changelog_dark.svg",
        ),
        light: vscode.Uri.joinPath(
          context.extensionUri,
          "media",
          "changelog_light.svg",
        ),
      },
    });

    this.initialize();
  }

  private initialize() {
    this.onRequest(
      ChangelogLinkRequest.type,
      async (params: ChangelogLinkRequestParams) => {
        const uri = vscode.Uri.parse(params.url);
        await vscode.env.openExternal(uri);
        sendActionEvent(
          TelemetryViews.ChangelogPage,
          TelemetryActions.OpenLink,
          {
            url: params.url,
          },
        );
      },
    );

    this.onRequest(
      ChangelogCommandRequest.type,
      async (params: ChangelogCommandRequestParams) => {
        vscode.commands.executeCommand(
          params.commandId,
          ...(params.args || []),
        );
        sendActionEvent(
          TelemetryViews.ChangelogPage,
          TelemetryActions.ExecuteCommand,
          {
            command: params.commandId,
          },
        );
      },
    );

    this.onRequest(CloseChangelogRequest.type, async () => {
      this.panel.dispose();
      sendActionEvent(
        TelemetryViews.ChangelogPage,
        TelemetryActions.CloseChangelog,
      );
    });

    this.onRequest(ChangelogDontShowAgainRequest.type, async () => {
      // Update configuration to not show changelog on update
      await vscode.workspace
        .getConfiguration()
        .update(
          constants.configShowChangelogOnUpdate,
          false,
          vscode.ConfigurationTarget.Global,
        );
      this.panel.dispose();
      sendActionEvent(
        TelemetryViews.ChangelogPage,
        TelemetryActions.ChangelogDontShowAgain,
      );
    });
  }

  public static async showChangelogOnExtensionUpdate(
    context: vscode.ExtensionContext,
  ) {
    const globalState = context?.globalState;
    if (!globalState) {
      return;
    }

    const lastChangeLogVersion = globalState.get(
      GLOBAL_STATE_LAST_CHANGELOG_VERSION_KEY,
    );

    const currentVersion = vscode.extensions.getExtension(constants.extensionId)
      ?.packageJSON.version;

    const isShownOnCurrentVersion = lastChangeLogVersion === currentVersion;

    if (!isShownOnCurrentVersion && this.shouldShowChangelogOnUpdate()) {
      await vscode.commands.executeCommand(constants.cmdOpenChangelog);
      await globalState.update(
        GLOBAL_STATE_LAST_CHANGELOG_VERSION_KEY,
        currentVersion,
      );
    }
  }

  /**
   * Determines whether to show the changelog on update based on user settings.
   * @returns A promise that resolves to true if the changelog should be shown, false otherwise.
   */
  public static shouldShowChangelogOnUpdate() {
    const vscodeConfig = vscode.workspace.getConfiguration();
    const configValues = vscodeConfig.inspect<boolean>(
      constants.configShowChangelogOnUpdate,
    );

    return configValues?.globalValue ?? configValues?.defaultValue ?? true;
  }
}
