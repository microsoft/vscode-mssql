"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountType = exports.AzureAuthType = void 0;
var AzureAuthType;
(function (AzureAuthType) {
    AzureAuthType[AzureAuthType["AuthCodeGrant"] = 0] = "AuthCodeGrant";
    AzureAuthType[AzureAuthType["DeviceCode"] = 1] = "DeviceCode";
})(AzureAuthType = exports.AzureAuthType || (exports.AzureAuthType = {}));
var AccountType;
(function (AccountType) {
    AccountType["Microsoft"] = "microsoft";
    AccountType["WorkSchool"] = "work_school";
})(AccountType = exports.AccountType || (exports.AccountType = {}));
//# sourceMappingURL=account.js.map