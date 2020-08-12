"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzureCodeGrant = void 0;
const azureAuth_1 = require("./azureAuth");
const models_1 = require("../models");
const crypto = __importStar(require("crypto"));
const qs = __importStar(require("qs"));
const azureAuthError_1 = require("../errors/azureAuthError");
const errors_1 = require("../errors/errors");
class AzureCodeGrant extends azureAuth_1.AzureAuth {
    constructor(providerSettings, secureStorage, cachingProvider, logger, messageDisplayer, errorLookup, userInteraction, stringLookup, authRequest) {
        super(providerSettings, secureStorage, cachingProvider, logger, messageDisplayer, errorLookup, userInteraction, stringLookup, models_1.AzureAuthType.AuthCodeGrant);
        this.providerSettings = providerSettings;
        this.secureStorage = secureStorage;
        this.cachingProvider = cachingProvider;
        this.logger = logger;
        this.messageDisplayer = messageDisplayer;
        this.errorLookup = errorLookup;
        this.userInteraction = userInteraction;
        this.stringLookup = stringLookup;
        this.authRequest = authRequest;
    }
    async login(tenant, resource) {
        let authCompleteDeferred;
        let authCompletePromise = new Promise((resolve, reject) => authCompleteDeferred = { resolve, reject });
        const { codeVerifier, codeChallenge } = this.createCryptoValues();
        const state = await this.authRequest.getState();
        const loginQuery = {
            response_type: 'code',
            response_mode: 'query',
            client_id: this.clientId,
            redirect_uri: this.providerSettings.redirectUri,
            state,
            prompt: 'select_account',
            code_challenge_method: 'S256',
            code_challenge: codeChallenge,
            resource: resource.id
        };
        const signInUrl = `${this.loginEndpointUrl}${tenant}/oauth2/authorize?${qs.stringify(loginQuery)}`;
        await this.userInteraction.openUrl(signInUrl);
        const authCode = await this.authRequest.getAuthorizationCode(state);
        const response = await this.getTokenWithAuthorizationCode(tenant, resource, {
            authCode,
            redirectUri: this.providerSettings.redirectUri,
            codeVerifier
        });
        if (!response) {
            throw new azureAuthError_1.AzureAuthError(errors_1.ErrorCodes.GetAccessTokenAuthCodeGrant, this.errorLookup.getSimpleError(errors_1.ErrorCodes.GetAccessTokenAuthCodeGrant));
        }
        return {
            authComplete: authCompleteDeferred,
            response
        };
    }
    /**
 * Requests an OAuthTokenResponse from Microsoft OAuth
 *
 * @param tenant
 * @param resource
 * @param authCode
 * @param redirectUri
 * @param codeVerifier
 */
    async getTokenWithAuthorizationCode(tenant, resource, { authCode, redirectUri, codeVerifier }) {
        const postData = {
            grant_type: 'authorization_code',
            code: authCode,
            client_id: this.clientId,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri,
            resource: resource.resource
        };
        return this.getToken(tenant, resource, postData);
    }
    createCryptoValues() {
        const codeVerifier = this.toBase64UrlEncoding(crypto.randomBytes(32).toString('base64'));
        const codeChallenge = this.toBase64UrlEncoding(crypto.createHash('sha256').update(codeVerifier).digest('base64'));
        return {
            codeVerifier, codeChallenge
        };
    }
}
exports.AzureCodeGrant = AzureCodeGrant;
//# sourceMappingURL=AzureCodeGrant.js.map