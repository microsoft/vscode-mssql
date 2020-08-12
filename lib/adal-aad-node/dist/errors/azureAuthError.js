"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzureAuthError = void 0;
class AzureAuthError extends Error {
    constructor(errorCode, errorMessage, originalException) {
        super(errorMessage);
        this.errorCode = errorCode;
        this.errorMessage = errorMessage;
        this.originalException = originalException;
    }
    getPrintableString() {
        var _a;
        return JSON.stringify({
            errorCode: this.errorCode,
            errorMessage: this.errorMessage,
            originalException: (_a = this.originalException) !== null && _a !== void 0 ? _a : ''
        }, undefined, 2);
    }
}
exports.AzureAuthError = AzureAuthError;
//# sourceMappingURL=azureAuthError.js.map