'use strict';
// import vscode = require('vscode');
import Constants = require('./constants');
import { IConnectionProfile } from './interfaces';
import { ConnectionCredentials } from './connectionCredentials';
import { QuestionTypes, IQuestion, IPrompter } from '../prompts/question';

// Concrete implementation of the IConnectionProfile interface

/**
 * A concrete implementation of an IConnectionProfile with support for profile creation and validation
 */
export class ConnectionProfile extends ConnectionCredentials implements IConnectionProfile {
    public profileName: string;
    public savePassword: boolean;

    /**
     * Creates a new profile by prompting the user for information.
     * @param  {IPrompter} prompter that asks user the questions needed to complete a profile
     * @returns Promise - resolves to undefined if profile creation was not completed, or IConnectionProfile if completed
     */
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

        return prompter.prompt(questions).then(() => {
            if (profile.isValidProfile()) {
                return profile;
            }
            // returning undefined to indicate failure to create the profile
            return undefined;
        });
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

    // Assumption: having server + profile name indicates all requirements were met
    private isValidProfile(): boolean {
        return (this.server !== undefined && this.profileName !== undefined);
    }
}
