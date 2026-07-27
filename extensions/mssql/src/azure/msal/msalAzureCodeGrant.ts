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
import { ILogger } from "../../sharedInterfaces/logger";
import { MsalAzureAuth } from "./msalAzureAuth";
import { SimpleWebServer } from "../simpleWebServer";
import { AzureAuthError } from "../azureAuthError";
import * as Constants from "../constants";
import * as LocalizedConstants from "../../constants/locConstants";
import * as path from "path";
import * as http from "http";
import { promises as fs } from "fs";

export const formPostResponseMode = "form_post";

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
        protected readonly logger: ILogger,
    ) {
        super(providerSettings, context, clientApplication, AzureAuthType.AuthCodeGrant, logger);
        this.cryptoProvider = new CryptoProvider();
        this.pkceCodes = {
            nonce: "",
            challengeMethod: Constants.s256CodeChallengeMethod, // Use SHA256 as the challenge method
            codeVerifier: "", // Generate a code verifier for the Auth Code Request first
            codeChallenge: "", // Generate a code challenge from the previously generated code verifier
        };
    }

    protected async login(
        tenant: ITenant,
        scopes?: string[],
    ): Promise<{
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

        const effectiveScopes = scopes ?? this.scopes;

        let authority = this.loginEndpointUrl + tenant.id;
        this.logger.info(`Authority URL set to: ${authority}`);

        try {
            let authUrlRequest: AuthorizationUrlRequest;
            authUrlRequest = {
                scopes: effectiveScopes,
                redirectUri: `${this.redirectUri}:${serverPort}/redirect`,
                codeChallenge: this.pkceCodes.codeChallenge,
                codeChallengeMethod: this.pkceCodes.challengeMethod,
                prompt: Constants.selectAccount,
                authority: authority,
                responseMode: formPostResponseMode,
                state: state,
            };
            authCodeRequest = {
                scopes: effectiveScopes,
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

        const readRequestBody = async (req: http.IncomingMessage): Promise<string> => {
            return new Promise<string>((resolve, reject) => {
                const chunks: Buffer[] = [];
                req.on("data", (chunk: Buffer) => chunks.push(chunk));
                req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
                req.on("error", reject);
            });
        };

        const getAuthResponseParams = async (
            req: http.IncomingMessage,
            reqUrl: URL,
        ): Promise<URLSearchParams> => {
            if (req.method?.toUpperCase() === "POST") {
                return new URLSearchParams(await readRequestBody(req));
            }

            return reqUrl.searchParams;
        };

        const authResponses = new Map<string, URLSearchParams>();

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
            let receivedNonce: string = reqUrl.searchParams.get("nonce") ?? "";
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
                void getAuthResponseParams(req, reqUrl)
                    .then((params) => {
                        const state = params.get("state") ?? "";
                        const split = state.split(",");
                        if (split.length !== 2) {
                            res.writeHead(400, { "content-type": "text/html" });
                            res.write(LocalizedConstants.azureAuthStateError);
                            res.end();
                            reject(new Error("State mismatch"));
                            return;
                        }

                        const port = split[0];
                        const callbackId = this.cryptoProvider.createNewGuid();
                        authResponses.set(callbackId, params);

                        res.writeHead(302, {
                            Location: `http://127.0.0.1:${port}/callback?callbackId=${encodeURIComponent(callbackId)}`,
                        });
                        res.end();
                    })
                    .catch((error) => {
                        this.logger.error("Failed to parse authentication response", error);
                        res.writeHead(400, { "content-type": "text/html" });
                        res.write(LocalizedConstants.azureAuthStateError);
                        res.end();
                        reject(error);
                    });
            });

            server.on("/callback", (req, reqUrl, res) => {
                const callbackId = reqUrl.searchParams.get("callbackId") ?? "";
                const authResponseParams = authResponses.get(callbackId);
                authResponses.delete(callbackId);

                if (!authResponseParams) {
                    res.writeHead(400, { "content-type": "text/html" });
                    res.write(LocalizedConstants.azureAuthStateError);
                    res.end();
                    reject(new Error("Callback ID mismatch"));
                    return;
                }

                const state = authResponseParams.get("state") ?? "";
                const code = authResponseParams.get("code") ?? "";

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
                        ).catch((error) =>
                            this.logger.error("Failed to send auth landing page", error),
                        );
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
