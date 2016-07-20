/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';

import { workspace, Disposable, ExtensionContext } from 'vscode';
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TransportKind } from 'vscode-languageclient';

export default function createLanguageClient(context: ExtensionContext) {

    let serverCommand = 'dotnet.exe';
    let serverArgs = [ context.asAbsolutePath(path.join('tools', 'servicehost.dll')) ];
    let serverOptions: ServerOptions = {  command: serverCommand, args: serverArgs, transport: TransportKind.stdio  };

    // Options to control the language client
    let clientOptions: LanguageClientOptions = {
        documentSelector: ['sql'],
        synchronize: {
            configurationSection: 'sqlTools'
        }
    }

    // Create the language client and start the client.
    let disposable = new LanguageClient('sqlserverclient', serverOptions, clientOptions).start();

    // Push the disposable to the context's subscriptions so that the
    // client can be deactivated on extension deactivation
    context.subscriptions.push(disposable);
}
