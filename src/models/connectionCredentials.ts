'use strict';
import vscode = require('vscode');
import Constants = require('./constants');
import { PropertyUpdater } from './propertyUpdater';
import { IConnectionCredentials } from './interfaces';
import { isEmpty } from './utils';

// Concrete implementation of the IConnectionCredentials interface
export class ConnectionCredentials implements IConnectionCredentials {
    server: string;
    database: string;
    user: string;
    password: string;
    connectionTimeout: number;
    requestTimeout: number;
    options: { encrypt: boolean, appName: string };

    // Gets an array of PropertyUpdaters that define the steps to set all needed values for a new Connection
    public static getCreateCredentialsSteps(isPasswordRequired: boolean): PropertyUpdater<IConnectionCredentials>[]  {
        let steps: PropertyUpdater<IConnectionCredentials>[] = [
            // server
            new PropertyUpdater<IConnectionCredentials>(
                this.createInputBoxOptions(Constants.serverPlaceholder, Constants.serverPrompt),
                (c) => isEmpty(c.server),
                (c, input) => c.server = input),

            // database (defaults to master)
            new PropertyUpdater<IConnectionCredentials>(
                this.createInputBoxOptions(Constants.databasePlaceholder, Constants.databasePrompt, Constants.databaseDefaultValue),
                (c) => isEmpty(c.database),
                (c, input) => c.database = input)
        ];
        // Add username and password
        steps = steps.concat(ConnectionCredentials.getUsernameAndPasswordCredentialUpdaters(isPasswordRequired));
        return steps;
    }

    // Gets an array of PropertyUpdaters that ensure Username and Password are set on this connection
    public static getUsernameAndPasswordCredentialUpdaters(isPasswordRequired: boolean): PropertyUpdater<IConnectionCredentials>[]  {
        let steps: PropertyUpdater<IConnectionCredentials>[] = [
            // username
            new PropertyUpdater<IConnectionCredentials>(
                this.createInputBoxOptions(Constants.usernamePlaceholder, Constants.usernamePrompt),
                (c) => isEmpty(c.user),
                (c, input) => c.user = input),

            // password
            new PropertyUpdater<IConnectionCredentials>(
                // Use password field
                this.createInputBoxOptions(Constants.passwordPlaceholder, Constants.passwordPrompt, undefined, true, isPasswordRequired),
                (c) => isEmpty(c.password),
                (c, input) => c.password = input)
        ];

        return steps;
    }

    private static createInputBoxOptions(
        placeholder: string, prompt: string, defaultValue: string = '', pwd: boolean = false,
        checkForEmpty: boolean = true): vscode.InputBoxOptions {

        let validate = function(input: string, propertyName: string): string {
            if (checkForEmpty && isEmpty(input)) {
                return propertyName + Constants.msgIsRequired;
            }
            // returning undefined indicates validation passed
            return undefined;
        };

        return {
            placeHolder: placeholder,
            prompt: prompt,
            value: defaultValue,
            password: pwd,
            validateInput: (i) => validate(i, prompt)
        };
    }

}

