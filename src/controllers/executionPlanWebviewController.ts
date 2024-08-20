/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebViewPanelController } from "./reactWebviewController";
import * as ep from "../reactviews/pages/ExecutionPlan/executionPlanInterfaces";
import { WebviewRoute } from "../sharedInterfaces/webviewRoutes";
import * as LocalizedConstants from "../constants/localizedConstants";
import { homedir } from "os";

export class ExecutionPlanWebViewController extends ReactWebViewPanelController<
  ep.ExecutionPlanWebViewState,
  ep.ExecutionPlanReducers
> {
  constructor(
    context: vscode.ExtensionContext,
    private _executionPlanService: ep.ExecutionPlanService,
    private executionPlanContents: string,
    // needs ts-ignore because linter doesn't recognize that fileName is being used in the call to super
    // @ts-ignore
    private fileName: string
  ) {
    super(
      context,
      `${fileName} ${LocalizedConstants.executionPlan}`,
      WebviewRoute.executionPlan,
      {},
      vscode.ViewColumn.Active,
      {
        dark: vscode.Uri.joinPath(
          context.extensionUri,
          "media",
          "executionPlan_inverse.svg"
        ),
        light: vscode.Uri.joinPath(
          context.extensionUri,
          "media",
          "executionPlan.svg"
        ),
      }
    );
    this.state.isLoading = true;
    this.initialize();
  }

  private async initialize() {
    this.state.sqlPlanContent = this.executionPlanContents;
	  this.state.theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? "dark" : "light";
    this.state.localizedConstants = LocalizedConstants;

    await this.getExecutionPlan();
    this.state.totalCost = this.calculateTotalCost();
    this.registerRpcHandlers();
    this.state.isLoading = false;
  }

  private registerRpcHandlers() {
    this.registerReducer("getExecutionPlan", async (state, payload) => {
      await this.getExecutionPlan();

      return {
        ...state,
        executionPlan: this.state.executionPlan,
        executionPlanGraphs: this.state.executionPlanGraphs
      };
    });
    this.registerReducer("saveExecutionPlan", async (state, payload) => {
      const homeDir = homedir();
      const documentsFolder = vscode.Uri.file(`${homeDir}/Documents`);

      let filename: vscode.Uri;
      let counter = 1;
      if (await this.fileExists(documentsFolder, `plan.sqlplan`)) {
        while (
          await this.fileExists(documentsFolder, `plan${counter}.sqlplan`)
        ) {
          counter += 1;
        }
        filename = vscode.Uri.joinPath(
          documentsFolder,
          `plan${counter}.sqlplan`
        );
      } else {
        filename = vscode.Uri.joinPath(documentsFolder, "plan.sqlplan");
      }

      // Show a save dialog to the user
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: filename,
        filters: {
          "SQL Plan Files": ["sqlplan"],
        },
      });

      if (saveUri) {
        // Write the content to the new file
        await vscode.workspace.fs.writeFile(
          saveUri,
          Buffer.from(payload.sqlPlanContent)
        );
      }

      return state;
    });
    this.registerReducer("showPlanXml", async (state, payload) => {
      const planXmlDoc = await vscode.workspace.openTextDocument({
        content: payload.sqlPlanContent,
        language: 'xml'
      });

      await vscode.window.showTextDocument(planXmlDoc);

      return state;
    });
    this.registerReducer("showQuery", async (state, payload) => {
      const sqlDoc = await vscode.workspace.openTextDocument({
        content: payload.query,
        language: 'sql'
      });

      await vscode.window.showTextDocument(sqlDoc);

      return state;
    });
    this.registerReducer("updateTotalCost", async (state, payload) => {
      this.state.totalCost += payload.totalCost;

      return {
        ...state,
        totalCost: this.state.totalCost
      };
    });
  }

  private async getExecutionPlan() {
    if (!this.state.executionPlan) {
      const planFile: ep.ExecutionPlanGraphInfo = {
        graphFileContent: this.executionPlanContents,
        graphFileType: ".sqlplan",
      };
      this.state.executionPlan =
        await this._executionPlanService.getExecutionPlan(planFile);
      this.state.executionPlanGraphs = this.state.executionPlan.graphs;
    }
  }

  private async fileExists(
    uri: vscode.Uri,
    filename: string
  ): Promise<boolean> {
    const path = vscode.Uri.joinPath(uri, filename);
    try {
      await vscode.workspace.fs.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  private calculateTotalCost(): number {
    let sum = 0;
    for (const graph of this.state.executionPlanGraphs!) {
      sum += (graph.root.cost + graph.root.subTreeCost);
    }
    return sum;
  }
}
