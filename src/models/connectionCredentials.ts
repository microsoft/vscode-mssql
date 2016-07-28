'use strict';
import Interfaces = require('./interfaces');

// Concrete implementation of the IConnectionCredentials interface
export class ConnectionCredentials implements Interfaces.IConnectionCredentials {
    server: string;
    database: string;
    user: string;
    password: string;
    connectionTimeout: number;
    requestTimeout: number;
    options: { encrypt: boolean, appName: string };
}

