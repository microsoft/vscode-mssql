/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ConnectionUI } from "../../src/views/connectionUI";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { IPrompter } from "../../src/prompts/question";
import { ConnectionStore } from "../../src/models/connectionStore";
import ConnectionManager from "../../src/controllers/connectionManager";
import {
  IConnectionCredentialsQuickPickItem,
  CredentialsQuickPickItemType,
} from "../../src/models/interfaces";
import { ConnectionCredentials } from "../../src/models/connectionCredentials";
import { AccountStore } from "../../src/azure/accountStore";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { stubVscodeWrapper } from "./utils";

const expect = chai.expect;

chai.use(sinonChai);

suite("Connection UI tests", () => {
  let sandbox: sinon.SinonSandbox;
  let connectionUI: ConnectionUI;

  let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
  let connectionStoreStub: sinon.SinonStubbedInstance<ConnectionStore>;
  let connectionManagerStub: sinon.SinonStubbedInstance<ConnectionManager>;
  let accountStoreStub: sinon.SinonStubbedInstance<AccountStore>;

  let promptStub: sinon.SinonStub;
  let promptSingleStub: sinon.SinonStub;
  let prompter: IPrompter;

  let quickPick: vscode.QuickPick<IConnectionCredentialsQuickPickItem>;
  let quickPickShowStub: sinon.SinonStub;
  let quickPickHideStub: sinon.SinonStub;
  let quickPickDisposeStub: sinon.SinonStub;
  let onDidChangeSelectionEmitter: vscode.EventEmitter<
    IConnectionCredentialsQuickPickItem[]
  >;
  let onDidHideEmitter: vscode.EventEmitter<void>;

  setup(() => {
    sandbox = sinon.createSandbox();

    vscodeWrapperStub = stubVscodeWrapper(sandbox);
    const outputChannel = vscodeWrapperStub.outputChannel;

    quickPickShowStub = sandbox.stub();
    quickPickHideStub = sandbox.stub();
    quickPickDisposeStub = sandbox.stub();
    onDidChangeSelectionEmitter = new vscode.EventEmitter<
      IConnectionCredentialsQuickPickItem[]
    >();
    onDidHideEmitter = new vscode.EventEmitter<void>();

    quickPick = {
      items: [],
      placeholder: undefined,
      matchOnDescription: false,
      ignoreFocusOut: false,
      canSelectMany: false,
      busy: false,
      show: quickPickShowStub,
      hide: quickPickHideStub,
      dispose: quickPickDisposeStub,
      onDidChangeSelection: onDidChangeSelectionEmitter.event,
      onDidHide: onDidHideEmitter.event,
    } as unknown as vscode.QuickPick<IConnectionCredentialsQuickPickItem>;

    vscodeWrapperStub.createOutputChannel.returns(outputChannel);
    vscodeWrapperStub.createQuickPick.returns(quickPick);
    vscodeWrapperStub.showErrorMessage.resolves(undefined);
    vscodeWrapperStub.executeCommand.resolves(undefined);

    connectionStoreStub = sandbox.createStubInstance(ConnectionStore);
    connectionManagerStub = sandbox.createStubInstance(ConnectionManager);
    accountStoreStub = sandbox.createStubInstance(AccountStore);

    promptStub = sandbox.stub();
    promptSingleStub = sandbox.stub();
    prompter = {
      prompt: promptStub,
      promptSingle: promptSingleStub,
      promptCallback: sandbox.stub(),
    } as unknown as IPrompter;

    connectionUI = new ConnectionUI(
      connectionManagerStub,
      connectionStoreStub,
      accountStoreStub,
      prompter,
      vscodeWrapperStub,
    );
  });

  teardown(() => {
    onDidChangeSelectionEmitter.dispose();
    onDidHideEmitter.dispose();
    sandbox.restore();
  });

  test("showConnections with recent and new connection", async () => {
    const item: IConnectionCredentialsQuickPickItem = {
      connectionCreds: undefined,
      quickPickItemType: CredentialsQuickPickItemType.NewConnection,
      label: undefined,
    };
    const mockConnection = { connectionString: "test" };

    promptStub.resolves(mockConnection);

    const promptPromise = connectionUI.promptForConnection(undefined);
    onDidChangeSelectionEmitter.fire([item]);
    await promptPromise;

    expect(quickPickShowStub).to.have.been.calledOnce;
  });

  test("showConnections with recent and edit connection", async () => {
    const testCreds = new ConnectionCredentials();
    testCreds.connectionString = "test";
    const item: IConnectionCredentialsQuickPickItem = {
      connectionCreds: testCreds,
      quickPickItemType: CredentialsQuickPickItemType.Mru,
      label: undefined,
    };

    const promptPromise = connectionUI.promptForConnection(undefined);
    onDidChangeSelectionEmitter.fire([item]);
    await promptPromise;

    expect(quickPickShowStub).to.have.been.calledOnce;
  });

  test("showConnections with recent but no selection", async () => {
    const promptForConnectionPromise =
      connectionUI.promptForConnection(undefined);
    onDidHideEmitter.fire();
    await promptForConnectionPromise;

    expect(quickPickShowStub).to.have.been.calledOnce;
  });

  test("promptLanguageFlavor should prompt for a language flavor", async () => {
    const mockProvider = { providerId: "test" };
    promptSingleStub.resolves(mockProvider);

    await connectionUI.promptLanguageFlavor();

    expect(promptSingleStub).to.have.been.calledOnce;
  });

  test("promptToCancelConnection should prompt for cancellation", async () => {
    promptSingleStub.resolves(true);

    await connectionUI.promptToCancelConnection();

    expect(promptSingleStub).to.have.been.calledOnce;
  });

  test("promptForPassword should prompt for password", async () => {
    promptSingleStub.resolves("password");

    await connectionUI.promptToCancelConnection();

    expect(promptSingleStub).to.have.been.calledOnce;
  });

  test("promptToChangeLanguageMode should prompt for language mode - selection", async () => {
    promptSingleStub.resolves(true);

    const isLanguageModeSqlStub = sandbox.stub();
    // should return true to simulate the language mode being SQL
    isLanguageModeSqlStub.resolves(true);
    connectionUI["waitForLanguageModeToBeSql"] = isLanguageModeSqlStub;

    await connectionUI.promptToChangeLanguageMode();

    expect(promptSingleStub).to.have.been.calledOnce;
    expect(vscodeWrapperStub.executeCommand).to.have.been.calledOnceWithExactly(
      "workbench.action.editor.changeLanguageMode",
    );
  });

  test("promptToChangeLanguageMode should prompt for language mode - no selection", async () => {
    promptSingleStub.resolves(undefined);

    await connectionUI.promptToChangeLanguageMode();

    expect(promptSingleStub).to.have.been.calledOnce;
    expect(vscodeWrapperStub.executeCommand).to.not.have.been.called;
  });

  test("removeProfile should prompt for a profile and remove it", async () => {
    connectionStoreStub.getProfilePickListItems.resolves([
      {
        connectionCreds: undefined,
        quickPickItemType: undefined,
        label: "test",
      },
    ]);
    connectionStoreStub.removeProfile.resolves(true);
    const mockItem = {
      ConfirmRemoval: true,
      ChooseProfile: {
        connectionCreds: {},
      },
    };
    promptStub.resolves(mockItem);

    await connectionUI.removeProfile();

    expect(
      connectionStoreStub.getProfilePickListItems,
    ).to.have.been.calledOnceWithExactly(false);
    expect(promptStub).to.have.been.calledOnce;
    expect(connectionStoreStub.removeProfile).to.have.been.calledOnce;
  });

  test("removeProfile should show error if there are no profiles to remove", async () => {
    connectionStoreStub.getProfilePickListItems.resolves(undefined);

    await connectionUI.removeProfile();

    expect(
      connectionStoreStub.getProfilePickListItems,
    ).to.have.been.calledOnceWithExactly(false);
    expect(promptStub).to.not.have.been.called;
    expect(vscodeWrapperStub.showErrorMessage).to.have.been.calledOnce;
  });

  test("promptToManageProfiles should prompt to manage profile", async () => {
    promptSingleStub.resolves(true);

    await connectionUI.promptToManageProfiles();

    expect(promptSingleStub).to.have.been.calledOnce;
  });
});
