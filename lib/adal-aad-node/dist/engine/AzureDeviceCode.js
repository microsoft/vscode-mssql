"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzureDeviceCode = void 0;
const azureAuth_1 = require("./azureAuth");
const models_1 = require("../models");
const azureAuthError_1 = require("../errors/azureAuthError");
const errors_1 = require("../errors/errors");
class AzureDeviceCode extends azureAuth_1.AzureAuth {
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
        const uri = `${this.loginEndpointUrl}/${this.commonTenant.id}/oauth2/devicecode`;
        const postData = {
            client_id: this.clientId,
            resource: resource.resource
        };
        const postResult = await this.makePostRequest(uri, postData);
        const initialDeviceLogin = postResult.data;
        await this.authRequest.displayDeviceCodeScreen(initialDeviceLogin.message, initialDeviceLogin.user_code, initialDeviceLogin.verification_url);
        const finalDeviceLogin = await this.setupPolling(initialDeviceLogin);
        const accessTokenString = finalDeviceLogin.access_token;
        const refreshTokenString = finalDeviceLogin.refresh_token;
        const currentTime = new Date().getTime() / 1000;
        const expiresOn = `${currentTime + finalDeviceLogin.expires_in}`;
        const result = await this.getTokenHelper(tenant, resource, accessTokenString, refreshTokenString, expiresOn);
        if (!result) {
            // Error when getting access token for DeviceCodeLogin
            throw new azureAuthError_1.AzureAuthError(errors_1.ErrorCodes.GetAccessTokenDeviceCodeLogin, this.errorLookup.getSimpleError(errors_1.ErrorCodes.GetAccessTokenDeviceCodeLogin));
        }
        authCompletePromise.finally(async () => await this.authRequest.closeDeviceCodeScreen()).catch(this.logger.error);
        return {
            response: result,
            authComplete: authCompleteDeferred,
        };
    }
    setupPolling(info) {
        const fiveMinutes = 5 * 60 * 1000;
        return new Promise((resolve, reject) => {
            let timeout;
            const timer = setInterval(async () => {
                const x = await this.checkForResult(info);
                if (!x.access_token) {
                    return;
                }
                clearTimeout(timeout);
                clearInterval(timer);
                resolve(x);
            }, info.interval * 1000);
            timeout = setTimeout(() => {
                clearInterval(timer);
                // Error when getting access token for DeviceCodeLogin
                reject(new azureAuthError_1.AzureAuthError(11, this.errorLookup.getSimpleError(11)));
            }, fiveMinutes);
        });
    }
    async checkForResult(info) {
        const uri = `${this.loginEndpointUrl}/${this.commonTenant}/oauth2/token`;
        const postData = {
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            client_id: this.clientId,
            tenant: this.commonTenant.id,
            code: info.device_code
        };
        const postResult = await this.makePostRequest(uri, postData);
        const result = postResult.data;
        return result;
    }
}
exports.AzureDeviceCode = AzureDeviceCode;
//# sourceMappingURL=AzureDeviceCode.js.map