'use strict';
import Constants = require('./constants');
import { IConnectionCredentials, AuthenticationTypes } from './interfaces';
import * as utils from './utils';
import { QuestionTypes, IQuestion, IPrompter, INameValueChoice } from '../prompts/question';

import os = require('os');

// Concrete implementation of the IConnectionCredentials interface
export class ConnectionCredentials implements IConnectionCredentials {
    public server: string;
    public database: string;
    public authenticationType: string;
    public user: string;
    public password: string;
    public connectionTimeout: number;
    public requestTimeout: number;
    public options: { encrypt: boolean, appName: string };

    public static ensureRequiredPropertiesSet(
        credentials: IConnectionCredentials,
        isPasswordRequired: boolean,
        prompter: IPrompter): Promise<IConnectionCredentials> {

        let questions: IQuestion[] = ConnectionCredentials.getRequiredCredentialValuesQuestions(credentials, false, isPasswordRequired);
        return prompter.prompt(questions).then(() => credentials);
    }

    // gets a set of questions that ensure all required and core values are set
    protected static getRequiredCredentialValuesQuestions(
        credentials: IConnectionCredentials,
        promptForDbName: boolean,
        isPasswordRequired: boolean): IQuestion[] {

        let questions: IQuestion[] = [
            // Server must be present
            {
                type: QuestionTypes.input,
                name: Constants.serverPrompt,
                message: Constants.serverPrompt,
                placeHolder: Constants.serverPlaceholder,
                shouldPrompt: (answers) => utils.isEmpty(credentials.server),
                validate: (value) => ConnectionCredentials.validateRequiredString(Constants.serverPrompt, value),
                onAnswered: (value) => credentials.server = value
            },
            // Database name is not required, prompt is optional
            {
                type: QuestionTypes.input,
                name: Constants.databasePrompt,
                message: Constants.databasePrompt,
                placeHolder: Constants.databasePlaceholder,
                shouldPrompt: (answers) => promptForDbName,
                onAnswered: (value) => credentials.database = value
            },
            {
                type: QuestionTypes.expand,
                name: Constants.authTypePrompt,
                message: Constants.authTypePrompt,
                choices: this.getAuthenticationTypesChoice(),
                shouldPrompt: (answers) => utils.isEmpty(credentials.authenticationType),
                onAnswered: (value) => credentials.authenticationType = AuthenticationTypes[value]
            },
            // Username must be pressent
            {
                type: QuestionTypes.input,
                name: Constants.usernamePrompt,
                message: Constants.usernamePrompt,
                placeHolder: Constants.usernamePlaceholder,
                shouldPrompt: (answers) => utils.isEmpty(credentials.user),
                validate: (value) => ConnectionCredentials.validateRequiredString(Constants.usernamePrompt, value),
                onAnswered: (value) => credentials.user = value
            },
            // Password may or may not be necessary
            {
                type: QuestionTypes.password,
                name: Constants.passwordPrompt,
                message: Constants.passwordPrompt,
                placeHolder: Constants.passwordPlaceholder,
                shouldPrompt: (answers) => utils.isEmpty(credentials.password),
                validate: (value) => {
                    if (isPasswordRequired) {
                        return ConnectionCredentials.validateRequiredString(Constants.passwordPrompt, value);
                    }
                    return undefined;
                },
                onAnswered: (value) => credentials.password = value
            }
        ];
        return questions;
    }

    // Validates a string is not empty, returning undefined if true and an error message if not
    protected static validateRequiredString(property: string, value: string): string {
        if (utils.isEmpty(value)) {
            return property + Constants.msgIsRequired;
        }
        return undefined;
    }

    public static getAuthenticationTypesChoice(): INameValueChoice[] {
        let choices: INameValueChoice[] = [
            { name: Constants.authTypeSql, value: AuthenticationTypes.SqlPassword }
        ];
        // In the case of win32 support integrated. For all others only SqlAuth supported
        if ('win32' === os.platform()) {
             choices.push({ name: Constants.authTypeIntegrated, value: AuthenticationTypes.Integrated });
        }
        // TODO When Azure Active Directory is supported, add this here

        return choices;
    }
}

