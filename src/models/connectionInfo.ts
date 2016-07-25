'use strict';
import Constants = require('./constants');
import Interfaces = require('./interfaces');

// Fix up connection settings if we're connecting to Azure SQL
export function fixupConnectionCredentials(connCreds: Interfaces.IConnectionCredentials): Interfaces.IConnectionCredentials {
    if (!connCreds.server) {
        connCreds.server = '';
    }

    if (!connCreds.database) {
        connCreds.database = '';
    }

    if (!connCreds.user) {
        connCreds.user = '';
    }

    if (!connCreds.password) {
        connCreds.password = '';
    }

    if (!connCreds.connectionTimeout) {
        connCreds.connectionTimeout = Constants.defaultConnectionTimeout;
    }

    if (!connCreds.requestTimeout) {
        connCreds.requestTimeout = Constants.defaultRequestTimeout;
    }

    // default values for advanced options
    if (!connCreds.options) {
        connCreds.options = {encrypt: false, appName: Constants.extensionName};
    }

    // default value for encrypt
    if (!connCreds.options.encrypt) {
        connCreds.options.encrypt = false;
    }

    // default value for appName
    if (!connCreds.options.appName) {
        connCreds.options.appName = Constants.extensionName;
    }

    if (isAzureDatabase(connCreds.server)) {
        // always encrypt connection if connecting to Azure SQL
        connCreds.options.encrypt = true;

        // Ensure minumum connection timeout if connecting to Azure SQL
        if (connCreds.connectionTimeout < Constants.azureSqlDbConnectionTimeout) {
            connCreds.connectionTimeout = Constants.azureSqlDbConnectionTimeout;
        }

        // Ensure minumum request timeout if connecting to Azure SQL
        if (connCreds.requestTimeout < Constants.azureSqlDbRequestTimeout) {
            connCreds.requestTimeout = Constants.azureSqlDbRequestTimeout;
        }
    }
    return connCreds;
}

// return true if server name ends with '.database.windows.net'
function isAzureDatabase(server: string): boolean {
    return (server ? server.endsWith(Constants.sqlDbPrefix) : false);
}

export function dump(connCreds: Interfaces.IConnectionCredentials): string {
    let contents =  'server=' + (connCreds.server ? connCreds.server : 'null') +
                    ' | database=' + (connCreds.database ? connCreds.database : 'null') +
                    ' | username=' + (connCreds.user ? connCreds.user : 'null') +
                    ' | encrypt=' + connCreds.options.encrypt +
                    ' | connectionTimeout=' + connCreds.connectionTimeout +
                    ' | connectionTimeout=' + connCreds.requestTimeout;
    return contents;
}

// compare connections porperties, except for password
export function equals(connCreds: Interfaces.IConnectionCredentials, theOther: Interfaces.IConnectionCredentials): boolean {
    let equal = (connCreds.server === theOther.server) &&
                (connCreds.database === theOther.database) &&
                (connCreds.user === theOther.user) &&
                (connCreds.options.encrypt === theOther.options.encrypt) &&
                (connCreds.connectionTimeout === theOther.connectionTimeout) &&
                (connCreds.requestTimeout === theOther.requestTimeout);
    return equal;
}

export function getPicklistLabel(connCreds: Interfaces.IConnectionCredentials): string {
    return connCreds.server;
}

export function getPicklistDescription(connCreds: Interfaces.IConnectionCredentials): string {
    return '[' +
           'database: ' + (connCreds.database ? connCreds.database : '<connection default>') +
           ', username: ' + (connCreds.user ? connCreds.user : '<prompt>') +
           ']';
}

export function getPicklistDetails(connCreds: Interfaces.IConnectionCredentials): string {
    return '[' +
           'encrypt connection: ' + (connCreds.options.encrypt ? 'true' : 'false') +
           ', connection timeout: ' + connCreds.connectionTimeout + ' ms' +
           ', request timeout: ' + connCreds.requestTimeout + ' ms' +
           ']';
}

export function getTooltip(connCreds: Interfaces.IConnectionCredentials): string {
    return 'server: ' + connCreds.server + '\r\n' +
           'database: ' + (connCreds.database ? connCreds.database : '<connection default>') + '\r\n' +
           'username: ' + connCreds.user + '\r\n' +
           'encrypt connection: ' + (connCreds.options.encrypt ? 'true' : 'false') + '\r\n' +
           'connection timeout: ' + connCreds.connectionTimeout + ' ms\r\n' +
           'request timeout: ' + connCreds.requestTimeout + ' ms\r\n' +
           'appName: ' + connCreds.options.appName;
}
