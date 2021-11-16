/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as LocalizedConstants from '../constants/localizedConstants';
import { AuthRequest, AzureAuthError } from '@microsoft/ads-adal-library';
import { SimpleWebServer } from './simpleWebServer';
import * as crypto from 'crypto';
import * as http from 'http';
import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { AzureLogger } from '../azure/azureLogger';
import VscodeWrapper from '../controllers/vscodeWrapper';

export class AzureAuthRequest implements AuthRequest {
    simpleWebServer: SimpleWebServer;
    serverPort: string;
    nonce: string;
    context: vscode.ExtensionContext;
    logger: AzureLogger;
    _vscodeWrapper: VscodeWrapper;


    constructor(context: vscode.ExtensionContext, logger: AzureLogger) {
        this.simpleWebServer = new SimpleWebServer();
        this.serverPort = undefined;
        this.nonce = crypto.randomBytes(16).toString('base64');
        this.context = context;
        this.logger = logger;
        this._vscodeWrapper = new VscodeWrapper();
    }

    public getState(): string {
        return `${this.serverPort},${encodeURIComponent(this.nonce)}`;
    }

    public async getAuthorizationCode(signInUrl: string, authComplete: Promise<void>): Promise<string> {
        let mediaPath = path.join(this.context.extensionPath, 'media');
        // media path goes here - working directory for this extension
        const sendFile = async (res: http.ServerResponse, filePath: string, contentType: string): Promise<void> => {
            let fileContents;
            try {
                fileContents = await fs.readFile(filePath);
            } catch (ex) {
                this.logger.error(ex);
                res.writeHead(400);
                res.end();
                return;
            }

            res.writeHead(200, {
                'Content-Length': fileContents.length,
                'Content-Type': contentType
            });

            res.end(fileContents);
        };

        this.simpleWebServer.on('/landing.css', (req, reqUrl, res) => {
            sendFile(res, path.join(mediaPath, 'landing.css'), 'text/css; charset=utf-8').catch(this.logger.error);
        });

        this.simpleWebServer.on('/SignIn.svg', (req, reqUrl, res) => {
            sendFile(res, path.join(mediaPath, 'SignIn.svg'), 'image/svg+xml').catch(this.logger.error);
        });

        this.simpleWebServer.on('/signin', (req, reqUrl, res) => {
            let receivedNonce: string = reqUrl.query.nonce as string;
            receivedNonce = receivedNonce.replace(/ /g, '+');

            if (receivedNonce !== encodeURIComponent(this.nonce)) {
                res.writeHead(400, { 'content-type': 'text/html' });
                // res.write(localize('azureAuth.nonceError', 'Authentication failed due to a nonce mismatch, please close Azure Data Studio and try again.'));
                res.end();
                this.logger.error('nonce no match', receivedNonce, this.nonce);
                return;
            }
            res.writeHead(302, { Location: signInUrl });
            res.end();
        });

        return new Promise<string>((resolve, reject) => {
            this.simpleWebServer.on('/callback', (req, reqUrl, res) => {
                const state = reqUrl.query.state as string ?? '';
                const code = reqUrl.query.code as string ?? '';

                const stateSplit = state.split(',');
                if (stateSplit.length !== 2) {
                    res.writeHead(400, { 'content-type': 'text/html' });
                    // res.write(localize('azureAuth.stateError', 'Authentication failed due to a state mismatch, please close ADS and try again.'));
                    res.end();
                    reject(new Error('State mismatch'));
                    return;
                }

                if (stateSplit[1] !== encodeURIComponent(this.nonce)) {
                    res.writeHead(400, { 'content-type': 'text/html' });
                    // res.write(localize('azureAuth.nonceError', 'Authentication failed due to a nonce mismatch,
                    // please close Azure Data Studio and try again.'));
                    res.end();
                    reject(new Error('Nonce mismatch'));
                    return;
                }

                resolve(code);

                authComplete.then(() => {
                    sendFile(res, path.join(mediaPath, 'landing.html'), 'text/html; charset=utf-8').catch(console.error);
                }, (ex: Error) => {
                    res.writeHead(400, { 'content-type': 'text/html' });
                    res.write(ex.message);
                    res.end();
                });
            });
        });

        return;

        // check the state that is returned from the local web server for the server port and nonce


    // private addServerListeners(server: SimpleWebServer, )
    }

    public async displayDeviceCodeScreen(msg: string, userCode: string, verificationUrl: string): Promise<void> {
        // create a notification with the device code message, usercode, and verificationurl
        const selection = await this._vscodeWrapper.showInformationMessage(msg, LocalizedConstants.msgCopyAndOpenWebpage);
        if (selection === LocalizedConstants.msgCopyAndOpenWebpage) {
            this._vscodeWrapper.clipboardWriteText(userCode);
            await vscode.env.openExternal(vscode.Uri.parse(verificationUrl));
            console.log(msg);
            console.log(userCode);
            console.log(verificationUrl);
        }


        return;
    }

    public async closeDeviceCodeScreen(): Promise<void> {
        return;
    }

    public async startServer(): Promise<void> {
        try {
            this.serverPort = await this.simpleWebServer.startup();
        } catch (ex) {
            throw new AzureAuthError(13, 'Server could not start', ex);
        }
    }
}


