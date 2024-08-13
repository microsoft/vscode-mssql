import * as vscode from "vscode";
import { ReactWebViewPanelController } from "./reactWebviewController";
import * as ep from "../reactviews/pages/ExecutionPlan/executionPlanInterfaces";
import { WebviewRoute } from "../sharedInterfaces/webviewRoutes";

export class ExecutionPlanWebViewController extends ReactWebViewPanelController<
  ep.ExecutionPlanWebViewState,
  ep.ExecutionPlanReducers
> {
  constructor(
    context: vscode.ExtensionContext,
    private _executionPlanService: ep.ExecutionPlanService,
    private executionPlanContents: string
  ) {
    super(
      context,
      "Execution Plan",
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
    this.initialize();
  }

  private async initialize() {
    this.state.sqlPlanContent = this.executionPlanContents;

	this.state.theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? "dark" : "light";

    await this.getExecutionPlan();
    this.registerRpcHandlers();
  }

  private registerRpcHandlers() {
    this.registerReducer("getExecutionPlan", async (state, payload) => {
      await this.getExecutionPlan();

      return {
        ...state,
        executionPlan: this.state.executionPlan,
        executionPlanGraphs: this.state.executionPlanGraphs,
        query: this.state.query,
      };
    });
    this.registerReducer("saveExecutionPlan", async (state, payload) => {
      const homeDir = require("os").homedir(); // Get the user's home directory
      const documentsFolder = vscode.Uri.file(`${homeDir}/Documents`);

      let filename: vscode.Uri;
      let counter = 0;
      if (await this.fileExists(documentsFolder, `plan.sqlplan`)) {
        counter += 1;
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
      this.state.query = this.state.executionPlanGraphs[0].query;
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
}
