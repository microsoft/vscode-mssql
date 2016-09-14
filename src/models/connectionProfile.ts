'use strict';
// import vscode = require('vscode');
import Constants = require('./constants');
import { IConnectionProfile, AuthenticationTypes } from './interfaces';
import { ConnectionCredentials } from './connectionCredentials';
import { QuestionTypes, IQuestion, IPrompter, INameValueChoice } from '../prompts/question';
import * as utils from './utils';

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
     * @param  {IConnectionProfile} (optional) default profile values that will be prefilled for questions, if any
     * @returns Promise - resolves to undefined if profile creation was not completed, or IConnectionProfile if completed
     */
    public static createProfile(prompter: IPrompter, defaultProfileValues?: IConnectionProfile): Promise<IConnectionProfile> {
        let profile: ConnectionProfile = new ConnectionProfile();
        // Ensure all core propertiesare entered
        let authOptions: INameValueChoice[] = ConnectionCredentials.getAuthenticationTypesChoice();
        if (authOptions.length === 1) {
            // Set default value as there is only 1 option
            profile.authenticationType = authOptions[0].value;
        }

        let questions: IQuestion[] = ConnectionCredentials.getRequiredCredentialValuesQuestions(profile, true, true, defaultProfileValues);
        // Check if password needs to be saved
        questions.push(
            {
                type: QuestionTypes.confirm,
                name: Constants.msgSavePassword,
                message: Constants.msgSavePassword,
                shouldPrompt: (answers) => ConnectionCredentials.isPasswordBasedCredential(profile),
                onAnswered: (value) => profile.savePassword = value
            },
            {
                type: QuestionTypes.input,
                name: Constants.profileNamePrompt,
                message: Constants.profileNamePrompt,
                placeHolder: Constants.profileNamePlaceholder,
                default: defaultProfileValues ? defaultProfileValues.profileName : undefined,
                onAnswered: (value) => {
                    // Fall back to a default name if none specified
                    profile.profileName = value ? value : undefined;
                }
        });

        return prompter.prompt(questions).then(answers => {
            if (answers && profile.isValidProfile()) {
                return profile;
            }
            // returning undefined to indicate failure to create the profile
            return undefined;
        });
    }

    // Assumption: having server + profile name indicates all requirements were met
    private isValidProfile(): boolean {
        if (this.authenticationType) {
            if (this.authenticationType === AuthenticationTypes[AuthenticationTypes.Integrated]) {
                return utils.isNotEmpty(this.server);
            } else {
                return utils.isNotEmpty(this.server)
                    && utils.isNotEmpty(this.user);
            }
        }
        return false;
    }
}
