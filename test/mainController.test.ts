'use strict';
import * as TypeMoq from 'typemoq';

import vscode = require('vscode');
import * as utils from '../src/models/utils';
import * as Constants from '../src/models/constants';
import * as stubs from './stubs';
import * as interfaces from '../src/models/interfaces';
import { CredentialStore } from '../src/credentialstore/credentialstore';
import { ConnectionProfile } from '../src/models/connectionProfile';
import { ConnectionStore } from '../src/models/connectionStore';
import { ConnectionCredentials } from '../src/models/connectionCredentials';
import { IPrompter, IQuestion} from '../src/prompts/question';
import { TestPrompter } from './stubs';
import { IConnectionProfile, IConnectionCredentials } from '../src/models/interfaces';
import VscodeWrapper from '../src/controllers/vscodeWrapper';
import MainController from '../src/controllers/mainController.ts';

import assert = require('assert');

suite('MainController Tests', () => {
    let document: vscode.TextDocument;
    let wrapper: VscodeWrapper;

    setup(() => {
        // Setup a standard document
        document = <vscode.TextDocument> {

        };
        let wrapper = new VscodeWrapper();
        let mainController: MainController = new MainController();

    });

    test('onDidOpenTextDocument should call the connection managers onDidOpenTextDocument and register event' , done => {
        mainController.onDidOpenTextDocument();
    });

});
