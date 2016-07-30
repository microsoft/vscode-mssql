'use strict';
import { InputBoxOptions, QuickPickOptions } from 'vscode';
import Constants = require('./constants');
import { PropertyUpdater } from './propertyUpdater';
import { IConnectionCredentials } from './interfaces';
import { isEmpty } from './utils';

// Concrete implementation of the IConnectionCredentials interface
export class ConnectionCredentials implements IConnectionCredentials {
    public server: string;
    public database: string;
    public user: string;
    public password: string;
    public connectionTimeout: number;
    public requestTimeout: number;
    public options: { encrypt: boolean, appName: string };

    // Gets an array of PropertyUpdaters that ensure Username and Password are set on this connection
    public static getUsernameAndPasswordCredentialUpdaters(isPasswordRequired: boolean): PropertyUpdater<IConnectionCredentials>[]  {
        let steps: PropertyUpdater<IConnectionCredentials>[] = [
            // username
            PropertyUpdater.CreateInputBoxUpdater<IConnectionCredentials>(
                ConnectionCredentials.createInputBoxOptions(Constants.usernamePlaceholder, Constants.usernamePrompt),
                (c) => isEmpty(c.user),
                (c, input) => c.user = input),

            // password
            PropertyUpdater.CreateInputBoxUpdater<IConnectionCredentials>(
                // Use password field
                ConnectionCredentials.createInputBoxOptions(Constants.passwordPlaceholder, Constants.passwordPrompt, undefined, true, isPasswordRequired),
                (c) => isEmpty(c.password),
                (c, input) => c.password = input)
        ];

        return steps;
    }

    protected static createInputBoxOptions(
        placeholder: string, prompt: string, defaultValue: string = '', pwd: boolean = false,
        checkForEmpty: boolean = true): InputBoxOptions {

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

    protected static createQuickPickOptions(
        placeholder: string, prompt: string, defaultValue: string = '', pwd: boolean = false,
        checkForEmpty: boolean = true): QuickPickOptions {


        return {
            placeHolder: placeholder
        };
    }

}

