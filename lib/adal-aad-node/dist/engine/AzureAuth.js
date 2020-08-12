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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzureAuth = void 0;
const models_1 = require("../models");
const azureAuthError_1 = require("../errors/azureAuthError");
const errors_1 = require("../errors/errors");
const axios_1 = __importDefault(require("axios"));
const qs = __importStar(require("qs"));
const url = __importStar(require("url"));
class AzureAuth {
    constructor(providerSettings, secureStorage, cachingProvider, logger, messageDisplayer, errorLookup, userInteraction, stringLookup, azureAuthType) {
        this.providerSettings = providerSettings;
        this.secureStorage = secureStorage;
        this.cachingProvider = cachingProvider;
        this.logger = logger;
        this.messageDisplayer = messageDisplayer;
        this.errorLookup = errorLookup;
        this.userInteraction = userInteraction;
        this.stringLookup = stringLookup;
        this.azureAuthType = azureAuthType;
        this.commonTenant = {
            id: 'common',
            displayName: 'common'
        };
        this.clientId = providerSettings.id;
        this.loginEndpointUrl = providerSettings.loginEndpoint;
    }
    async startLogin() {
        let loginComplete;
        try {
            const result = await this.login(this.commonTenant, this.providerSettings.resources.windowsManagementResource);
            loginComplete = result === null || result === void 0 ? void 0 : result.authComplete;
            if (!(result === null || result === void 0 ? void 0 : result.response)) {
                this.logger.error('Authentication failed');
                return undefined;
            }
            const account = await this.hydrateAccount(result.response.accessToken, result.response.tokenClaims);
            loginComplete === null || loginComplete === void 0 ? void 0 : loginComplete.resolve();
            return account;
        }
        catch (ex) {
            if (ex instanceof azureAuthError_1.AzureAuthError) {
                loginComplete === null || loginComplete === void 0 ? void 0 : loginComplete.reject(ex.getPrintableString());
                // Let the caller deal with the error too.
                throw ex;
            }
            this.logger.error(ex);
            return undefined;
        }
    }
    getHomeTenant(account) {
        var _a, _b;
        // Home is defined by the API
        // Lets pick the home tenant - and fall back to commonTenant if they don't exist
        return (_b = (_a = account.properties.tenants.find(t => t.tenantCategory === 'Home')) !== null && _a !== void 0 ? _a : account.properties.tenants[0]) !== null && _b !== void 0 ? _b : this.commonTenant;
    }
    async refreshAccess(account) {
        // Deprecated account - delete it.
        if (account.key.accountVersion !== AzureAuth.ACCOUNT_VERSION) {
            account.delete = true;
            return account;
        }
        try {
            const tenant = this.getHomeTenant(account);
            const tokenResult = await this.getAccountSecurityToken(account, tenant.id, this.providerSettings.resources.windowsManagementResource);
            if (!tokenResult) {
                account.isStale = true;
                return account;
            }
            const tokenClaims = this.getTokenClaims(tokenResult.token);
            if (!tokenClaims) {
                account.isStale = true;
                return account;
            }
            return await this.hydrateAccount(tokenResult, tokenClaims);
        }
        catch (ex) {
            account.isStale = true;
            return account;
            // Let caller deal with it too.
            throw ex;
        }
    }
    async hydrateAccount(token, tokenClaims) {
        const tenants = await this.getTenants(Object.assign({}, token));
        const account = this.createAccount(tokenClaims, token.key, tenants);
        return account;
    }
    async getAccountSecurityToken(account, tenantId, azureResource) {
        if (account.isStale === true) {
            this.logger.log('Account was stale. No tokens being fetched.');
            return undefined;
        }
        const tenant = account.properties.tenants.find(t => t.id === tenantId);
        if (!tenant) {
            throw new azureAuthError_1.AzureAuthError(1, this.errorLookup.getTenantNotFoundError({ tenantId }), undefined);
        }
        const cachedTokens = await this.getSavedToken(tenant, azureResource, account.key);
        // Let's check to see if we can just use the cached tokens to return to the user
        if (cachedTokens === null || cachedTokens === void 0 ? void 0 : cachedTokens.accessToken) {
            let expiry = Number(cachedTokens.expiresOn);
            if (Number.isNaN(expiry)) {
                this.logger.log('Expiration time was not defined. This is expected on first launch');
                expiry = 0;
            }
            const currentTime = new Date().getTime() / 1000;
            let accessToken = cachedTokens.accessToken;
            const remainingTime = expiry - currentTime;
            const maxTolerance = 2 * 60; // two minutes
            if (remainingTime < maxTolerance) {
                const result = await this.refreshToken(tenant, azureResource, cachedTokens.refreshToken);
                if (!result) {
                    return undefined;
                }
                accessToken = result.accessToken;
            }
            // Let's just return here.
            if (accessToken) {
                return Object.assign(Object.assign({}, accessToken), { tokenType: 'Bearer' });
            }
        }
        // User didn't have any cached tokens, or the cached tokens weren't useful.
        // For most users we can use the refresh token from the general microsoft resource to an access token of basically any type of resource we want.
        const baseTokens = await this.getSavedToken(this.commonTenant, this.providerSettings.resources.windowsManagementResource, account.key);
        if (!baseTokens) {
            this.logger.error('User had no base tokens for the basic resource registered. This should not happen and indicates something went wrong with the authentication cycle');
            account.isStale = true;
            // Something failed with the authentication, or your tokens have been deleted from the system. Please try adding your account to Azure Data Studio again
            throw new azureAuthError_1.AzureAuthError(errors_1.ErrorCodes.AuthError, this.errorLookup.getSimpleError(errors_1.ErrorCodes.AuthError));
        }
        // Let's try to convert the access token type, worst case we'll have to prompt the user to do an interactive authentication.
        const result = await this.refreshToken(tenant, azureResource, baseTokens.refreshToken);
        if (result === null || result === void 0 ? void 0 : result.accessToken) {
            return Object.assign(Object.assign({}, result.accessToken), { tokenType: 'Bearer' });
        }
        return undefined;
    }
    /**
     * Refreshes a token, if a refreshToken is passed in then we use that. If it is not passed in then we will prompt the user for consent.
     * @param tenant
     * @param resource
     * @param refreshToken
     */
    async refreshToken(tenant, resource, refreshToken) {
        if (refreshToken) {
            const postData = {
                grant_type: 'refresh_token',
                client_id: this.clientId,
                refresh_token: refreshToken.token,
                tenant: tenant.id,
                resource: resource.resource
            };
            return this.getToken(tenant, resource, postData);
        }
        return this.handleInteractionRequired(tenant, resource);
    }
    async getToken(tenant, resource, postData) {
        const tokenUrl = `${this.loginEndpointUrl}${tenant.id}/oauth2/token`;
        const response = await this.makePostRequest(tokenUrl, postData);
        if (response.data.error === 'interaction_required') {
            return this.handleInteractionRequired(tenant, resource);
        }
        if (response.data.error) {
            this.logger.error('Response error!', response.data);
            // Token retrival failed with an error. Open developer tools to view the error
            throw new azureAuthError_1.AzureAuthError(errors_1.ErrorCodes.TokenRetrieval, this.errorLookup.getSimpleError(errors_1.ErrorCodes.TokenRetrieval));
        }
        const accessTokenString = response.data.access_token;
        const refreshTokenString = response.data.refresh_token;
        const expiresOnString = response.data.expires_on;
        return this.getTokenHelper(tenant, resource, accessTokenString, refreshTokenString, expiresOnString);
    }
    async getTokenHelper(tenant, resource, accessTokenString, refreshTokenString, expiresOnString) {
        var _a, _b, _c;
        if (!accessTokenString) {
            // No access token returned from Microsoft OAuth
            throw new azureAuthError_1.AzureAuthError(errors_1.ErrorCodes.NoAccessTokenReturned, this.errorLookup.getSimpleError(errors_1.ErrorCodes.NoAccessTokenReturned));
        }
        const tokenClaims = this.getTokenClaims(accessTokenString);
        if (!tokenClaims) {
            return undefined;
        }
        const userKey = (_c = (_b = (_a = tokenClaims.home_oid) !== null && _a !== void 0 ? _a : tokenClaims.oid) !== null && _b !== void 0 ? _b : tokenClaims.unique_name) !== null && _c !== void 0 ? _c : tokenClaims.sub;
        if (!userKey) {
            // The user had no unique identifier within AAD
            throw new azureAuthError_1.AzureAuthError(errors_1.ErrorCodes.UniqueIdentifier, this.errorLookup.getSimpleError(errors_1.ErrorCodes.UniqueIdentifier));
        }
        const accessToken = {
            token: accessTokenString,
            key: userKey
        };
        let refreshToken = undefined;
        if (refreshTokenString) {
            refreshToken = {
                token: refreshTokenString,
                key: userKey
            };
        }
        const result = {
            accessToken,
            refreshToken,
            tokenClaims,
            expiresOn: expiresOnString
        };
        const accountKey = {
            providerId: this.providerSettings.id,
            id: userKey
        };
        await this.saveToken(tenant, resource, accountKey, result);
        return result;
    }
    //#region tenant calls
    async getTenants(token) {
        const tenantUri = url.resolve(this.providerSettings.resources.azureManagementResource.resource, 'tenants?api-version=2019-11-01');
        try {
            const tenantResponse = await this.makeGetRequest(tenantUri, token.token);
            this.logger.pii('getTenants', tenantResponse.data);
            const tenants = tenantResponse.data.value.map((tenantInfo) => {
                var _a;
                return {
                    id: tenantInfo.tenantId,
                    displayName: (_a = tenantInfo.displayName) !== null && _a !== void 0 ? _a : tenantInfo.tenantId,
                    userId: token.key,
                    tenantCategory: tenantInfo.tenantCategory
                };
            });
            const homeTenantIndex = tenants.findIndex(tenant => tenant.tenantCategory === 'Home');
            if (homeTenantIndex >= 0) {
                const homeTenant = tenants.splice(homeTenantIndex, 1);
                tenants.unshift(homeTenant[0]);
            }
            return tenants;
        }
        catch (ex) {
            // Error retrieving tenant information
            throw new azureAuthError_1.AzureAuthError(errors_1.ErrorCodes.Tenant, this.errorLookup.getSimpleError(errors_1.ErrorCodes.Tenant), ex);
        }
    }
    //#endregion
    //#region token management
    async saveToken(tenant, resource, accountKey, { accessToken, refreshToken, expiresOn }) {
        if (!tenant.id || !resource.id) {
            this.logger.pii('Tenant ID or resource ID was undefined', tenant, resource);
            // Error when adding your account to the cache
            throw new azureAuthError_1.AzureAuthError(errors_1.ErrorCodes.AddAccount, this.errorLookup.getSimpleError(errors_1.ErrorCodes.AddAccount));
        }
        try {
            await this.cachingProvider.set(`${accountKey.id}_access_${resource.id}_${tenant.id}`, JSON.stringify(accessToken));
            await this.cachingProvider.set(`${accountKey.id}_refresh_${resource.id}_${tenant.id}`, JSON.stringify(refreshToken));
            await this.cachingProvider.set(`${accountKey.id}_${tenant.id}_${resource.id}`, expiresOn);
        }
        catch (ex) {
            this.logger.error(ex);
            // Error when adding your account to the cache
            throw new azureAuthError_1.AzureAuthError(errors_1.ErrorCodes.AddAccount, this.errorLookup.getSimpleError(errors_1.ErrorCodes.AddAccount));
        }
    }
    async getSavedToken(tenant, resource, accountKey) {
        if (!tenant.id || !resource.id) {
            this.logger.pii('Tenant ID or resource ID was undefined', tenant, resource);
            // Error when getting your account from the cache
            throw new azureAuthError_1.AzureAuthError(errors_1.ErrorCodes.GetAccount, this.errorLookup.getSimpleError(errors_1.ErrorCodes.GetAccount));
        }
        let accessTokenString;
        let refreshTokenString;
        let expiresOn;
        try {
            accessTokenString = await this.cachingProvider.get(`${accountKey.id}_access_${resource.id}_${tenant.id}`);
            refreshTokenString = await this.cachingProvider.get(`${accountKey.id}_refresh_${resource.id}_${tenant.id}`);
            expiresOn = await this.cachingProvider.get(`${accountKey.id}_${tenant.id}_${resource.id}`);
        }
        catch (ex) {
            this.logger.error(ex);
            // Error when getting your account from the cache
            throw new azureAuthError_1.AzureAuthError(errors_1.ErrorCodes.GetAccount, this.errorLookup.getSimpleError(errors_1.ErrorCodes.GetAccount));
        }
        try {
            if (!accessTokenString) {
                return undefined;
            }
            const accessToken = JSON.parse(accessTokenString);
            let refreshToken;
            if (refreshTokenString) {
                refreshToken = JSON.parse(refreshTokenString);
            }
            else {
                return undefined;
            }
            return {
                accessToken, refreshToken, expiresOn
            };
        }
        catch (ex) {
            this.logger.error(ex);
            // Error when parsing your account from the cache
            throw new azureAuthError_1.AzureAuthError(errors_1.ErrorCodes.ParseAccount, this.errorLookup.getSimpleError(errors_1.ErrorCodes.ParseAccount));
        }
    }
    //#endregion
    //#region interaction handling
    async handleInteractionRequired(tenant, resource) {
        var _a;
        const shouldOpen = await this.askUserForInteraction(tenant, resource);
        if (shouldOpen) {
            const result = await this.login(tenant, resource);
            (_a = result === null || result === void 0 ? void 0 : result.authComplete) === null || _a === void 0 ? void 0 : _a.resolve();
            return result === null || result === void 0 ? void 0 : result.response;
        }
        return undefined;
    }
    /**
     * Asks the user if they would like to do the interaction based authentication as required by OAuth2
     * @param tenant
     * @param resource
     */
    async askUserForInteraction(tenant, resource) {
        return this.userInteraction.askForConsent(this.stringLookup.getInteractionRequiredString({ tenant, resource }));
    }
    //#endregion
    //#region data modeling
    createAccount(tokenClaims, key, tenants) {
        var _a, _b, _c;
        // Determine if this is a microsoft account
        let accountType;
        if ((tokenClaims === null || tokenClaims === void 0 ? void 0 : tokenClaims.idp) === 'live.com') {
            accountType = models_1.AccountType.Microsoft;
        }
        else {
            accountType = models_1.AccountType.WorkSchool;
        }
        const name = (_b = (_a = tokenClaims.name) !== null && _a !== void 0 ? _a : tokenClaims.email) !== null && _b !== void 0 ? _b : tokenClaims.unique_name;
        const email = (_c = tokenClaims.email) !== null && _c !== void 0 ? _c : tokenClaims.unique_name;
        let displayName = name;
        if (email) {
            displayName = `${displayName} - ${email}`;
        }
        const account = {
            key: {
                providerId: this.providerSettings.id,
                id: key,
                accountVersion: AzureAuth.ACCOUNT_VERSION,
            },
            displayInfo: {
                accountType,
                userId: key,
                displayName,
                email,
                name,
            },
            properties: {
                providerSettings: this.providerSettings,
                isMsAccount: accountType === models_1.AccountType.Microsoft,
                tenants,
                azureAuthType: this.azureAuthType
            },
            isStale: false
        };
        return account;
    }
    //#endregion
    //#region network functions
    async makePostRequest(url, postData) {
        const config = {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            validateStatus: () => true // Never throw
        };
        // Intercept response and print out the response for future debugging
        const response = await axios_1.default.post(url, qs.stringify(postData), config);
        this.logger.pii(url, postData, response.data);
        return response;
    }
    async makeGetRequest(url, token) {
        const config = {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            validateStatus: () => true // Never throw
        };
        const response = await axios_1.default.get(url, config);
        this.logger.pii(url, response.data);
        return response;
    }
    //#endregion
    //#region utils
    getTokenClaims(accessToken) {
        try {
            const split = accessToken.split('.');
            return JSON.parse(Buffer.from(split[1], 'base64').toString('binary'));
        }
        catch (ex) {
            throw new Error('Unable to read token claims: ' + JSON.stringify(ex));
        }
    }
    toBase64UrlEncoding(base64string) {
        return base64string.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); // Need to use base64url encoding
    }
    async deleteAllCache() {
        await this.secureStorage.clear();
    }
}
exports.AzureAuth = AzureAuth;
AzureAuth.ACCOUNT_VERSION = '2.0';
//# sourceMappingURL=AzureAuth.js.map