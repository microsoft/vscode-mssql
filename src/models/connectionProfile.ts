'use strict';
// import vscode = require('vscode');
import Constants = require('./constants');
import { IConnectionProfile } from './interfaces';
import { ConnectionCredentials } from './connectionCredentials';
import { QuestionTypes, IQuestion, IPrompter } from '../prompts/question';

// Concrete implementation of the IConnectionProfile interface
export class ConnectionProfile extends ConnectionCredentials implements IConnectionProfile {
    public profileName: string;
    public savePassword: boolean;

    public static createProfile(prompter: IPrompter): Promise<IConnectionProfile> {
        let profile: ConnectionProfile = new ConnectionProfile();
        // Ensure all core propertiesare entered
        let questions: IQuestion[] = ConnectionCredentials.getRequiredCredentialValuesQuestions(profile, true, true);
        // Check if password needs to be saved
        questions.push(
            {
                type: QuestionTypes.confirm,
                name: Constants.msgSavePassword,
                message: Constants.msgSavePassword,
                onAnswered: (value) => profile.savePassword = value
            },
            {
                type: QuestionTypes.input,
                name: Constants.profileNamePrompt,
                message: Constants.profileNamePrompt,
                placeHolder: Constants.profileNamePlaceholder,
                onAnswered: (value) => {
                    // Fall back to a default name if none specified
                    profile.profileName = value ? value : ConnectionProfile.formatProfileName(profile);
                }
        });

        return prompter.prompt(questions).then(() => profile);
    }

    private static formatProfileName(profile: IConnectionProfile ): string {
        let name = profile.server;
        if (profile.database) {
            name = name + '-' + profile.database;
        }
        if (profile.user) {
            name = name + '-' + profile.user;
        }
        return name;
    }
}
