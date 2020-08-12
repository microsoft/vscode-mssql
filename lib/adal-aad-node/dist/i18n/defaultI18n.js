"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnUsStringLookup = void 0;
const simpleStringMapping = {
    2: 'Something failed with the authentication, or your tokens have been deleted from the system. Please try adding your account to Azure Data Studio again',
    3: 'Token retrival failed with an error. Open developer tools to view the error',
    4: 'No access token returned from Microsoft OAuth',
    5: 'The user had no unique identifier within AAD',
    6: 'Error retrieving tenant information'
};
class EnUsStringLookup {
    getSimpleString(code) {
        return simpleStringMapping[code];
    }
    getInteractionRequiredString({ tenant, resource }) {
        return `Your tenant '${tenant.displayName} (${tenant.id}) required you to re-authenticate to access ${resource.id} resources. Press Open to start the re-authentication process.`;
    }
}
exports.EnUsStringLookup = EnUsStringLookup;
//# sourceMappingURL=defaultI18n.js.map