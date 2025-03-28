/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    AuthenticationResult,
    AuthorizationCodeRequest,
    AuthorizationUrlRequest,
    CryptoProvider,
    PublicClientApplication,
} from "@azure/msal-node";
import { ITenant, AzureAuthType, IProviderSettings } from "../../models/contracts/azure";
import { IDeferred } from "../../models/interfaces";
import { Logger } from "../../models/logger";
import { MsalAzureAuth } from "./msalAzureAuth";
import { SimpleWebServer } from "../simpleWebServer";
import { AzureAuthError } from "../azureAuthError";
import * as Constants from "../constants";
import * as LocalizedConstants from "../../constants/locConstants";
import * as path from "path";
import * as http from "http";
import { promises as fs } from "fs";
import VscodeWrapper from "../../controllers/vscodeWrapper";

interface ICryptoValues {
    nonce: string;
    challengeMethod: string;
    codeVerifier: string;
    codeChallenge: string;
}

export class MsalAzureCodeGrant extends MsalAzureAuth {
    private pkceCodes: ICryptoValues;
    private cryptoProvider: CryptoProvider;

    constructor(
        protected readonly providerSettings: IProviderSettings,
        protected readonly context: vscode.ExtensionContext,
        protected clientApplication: PublicClientApplication,
        protected readonly vscodeWrapper: VscodeWrapper,
        protected readonly logger: Logger,
    ) {
        super(
            providerSettings,
            context,
            clientApplication,
            AzureAuthType.AuthCodeGrant,
            vscodeWrapper,
            logger,
        );
        this.cryptoProvider = new CryptoProvider();
        this.pkceCodes = {
            nonce: "",
            challengeMethod: Constants.s256CodeChallengeMethod, // Use SHA256 as the challenge method
            codeVerifier: "", // Generate a code verifier for the Auth Code Request first
            codeChallenge: "", // Generate a code challenge from the previously generated code verifier
        };
    }

    protected async login(tenant: ITenant): Promise<{
        response: AuthenticationResult;
        authComplete: IDeferred<void, Error>;
    }> {
        let authCompleteDeferred: IDeferred<void, Error>;
        let authCompletePromise = new Promise<void>(
            (resolve, reject) => (authCompleteDeferred = { resolve, reject }),
        );
        let serverPort: string;
        const server = new SimpleWebServer();

        try {
            serverPort = await server.startup();
        } catch (ex) {
            const msg = LocalizedConstants.azureServerCouldNotStart;
            throw new AzureAuthError(msg, "Server could not start", ex);
        }
        await this.createCryptoValuesMsal();
        const state = `${serverPort},${this.pkceCodes.nonce}`;
        let authCodeRequest: AuthorizationCodeRequest;

        let authority = this.loginEndpointUrl + tenant.id;
        this.logger.info(`Authority URL set to: ${authority}`);

        try {
            let authUrlRequest: AuthorizationUrlRequest;
            authUrlRequest = {
                scopes: this.scopes,
                redirectUri: `${this.redirectUri}:${serverPort}/redirect`,
                codeChallenge: this.pkceCodes.codeChallenge,
                codeChallengeMethod: this.pkceCodes.challengeMethod,
                prompt: Constants.selectAccount,
                authority: authority,
                state: state,
            };
            authCodeRequest = {
                scopes: this.scopes,
                redirectUri: `${this.redirectUri}:${serverPort}/redirect`,
                codeVerifier: this.pkceCodes.codeVerifier,
                authority: authority,
                code: "",
            };

            let authCodeUrl = await this.clientApplication.getAuthCodeUrl(authUrlRequest);
            await vscode.env.openExternal(
                vscode.Uri.parse(
                    `http://localhost:${serverPort}/signin?nonce=${encodeURIComponent(this.pkceCodes.nonce)}`,
                ),
            );
            const authCode = await this.addServerListeners(
                server,
                this.pkceCodes.nonce,
                authCodeUrl,
                authCompletePromise,
            );
            authCodeRequest.code = authCode;
        } catch (e) {
            this.logger.error("MSAL: Error requesting auth code", e);
            throw new AzureAuthError("error", "Error requesting auth code", e);
        }

        let result = await this.clientApplication.acquireTokenByCode(authCodeRequest);
        if (!result) {
            this.logger.error("Failed to acquireTokenByCode");
            this.logger.error(`Auth Code Request: ${JSON.stringify(authCodeRequest)}`);
            throw Error("Failed to fetch token using auth code");
        } else {
            return {
                response: result,
                authComplete: authCompleteDeferred!,
            };
        }
    }

    private async addServerListeners(
        server: SimpleWebServer,
        nonce: string,
        loginUrl: string,
        authComplete: Promise<void>,
    ): Promise<string> {
        const mediaPath = path.join(this.context.extensionPath, "media");

        // Utility function
        const sendFile = async (
            res: http.ServerResponse,
            filePath: string,
            contentType: string,
        ): Promise<void> => {
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
                "Content-Length": fileContents.length,
                "Content-Type": contentType,
            });

            res.end(fileContents);
        };

        server.on("/landing.css", (req, reqUrl, res) => {
            sendFile(res, path.join(mediaPath, "landing.css"), "text/css; charset=utf-8").catch(
                this.logger.error,
            );
        });

        server.on("/SignIn.svg", (req, reqUrl, res) => {
            sendFile(res, path.join(mediaPath, "SignIn.svg"), "image/svg+xml").catch(
                this.logger.error,
            );
        });

        server.on("/signin", (req, reqUrl, res) => {
            let receivedNonce: string = reqUrl.query.nonce as string;
            receivedNonce = receivedNonce.replace(/ /g, "+");

            if (receivedNonce !== nonce) {
                res.writeHead(400, { "content-type": "text/html" });
                res.write(LocalizedConstants.azureAuthNonceError);
                res.end();
                this.logger.error("nonce no match", receivedNonce, nonce);
                return;
            }
            res.writeHead(302, { Location: loginUrl });
            res.end();
        });

        return new Promise<string>((resolve, reject) => {
            server.on("/redirect", (req, reqUrl, res) => {
                const state = (reqUrl.query.state as string) ?? "";
                const split = state.split(",");
                if (split.length !== 2) {
                    res.writeHead(400, { "content-type": "text/html" });
                    res.write(LocalizedConstants.azureAuthStateError);
                    res.end();
                    reject(new Error("State mismatch"));
                    return;
                }
                const port = split[0];
                res.writeHead(302, {
                    Location: `http://127.0.0.1:${port}/callback${reqUrl.search}`,
                });
                res.end();
            });

            server.on("/callback", (req, reqUrl, res) => {
                const state = (reqUrl.query.state as string) ?? "";
                const code = (reqUrl.query.code as string) ?? "";

                const stateSplit = state.split(",");
                if (stateSplit.length !== 2) {
                    res.writeHead(400, { "content-type": "text/html" });
                    res.write(LocalizedConstants.azureAuthStateError);
                    res.end();
                    reject(new Error("State mismatch"));
                    return;
                }

                if (stateSplit[1] !== encodeURIComponent(nonce)) {
                    res.writeHead(400, { "content-type": "text/html" });
                    res.write(LocalizedConstants.azureAuthNonceError);
                    res.end();
                    reject(new Error("Nonce mismatch"));
                    return;
                }

                resolve(code);

                authComplete.then(
                    () => {
                        sendFile(
                            res,
                            path.join(mediaPath, "landing.html"),
                            "text/html; charset=utf-8",
                        ).catch(console.error);
                    },
                    (ex: Error) => {
                        res.writeHead(400, { "content-type": "text/html" });
                        res.write(ex.message);
                        res.end();
                    },
                );
            });
        });
    }

    private async createCryptoValuesMsal(): Promise<void> {
        this.pkceCodes.nonce = this.cryptoProvider.createNewGuid();
        const { verifier, challenge } = await this.cryptoProvider.generatePkceCodes();
        this.pkceCodes.codeVerifier = verifier;
        this.pkceCodes.codeChallenge = challenge;
    }
}
