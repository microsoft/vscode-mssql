import * as TypeMoq from 'typemoq';
import { IConnectionProfile } from '../src/models/interfaces';
import { ConnectionProfile } from '../src/models/ConnectionProfile';
import { IQuestion, IPrompter } from '../src/prompts/question';
import TestPrompter from './TestPrompter';

import Constants = require('../src/models/constants');
import assert = require('assert');

suite('Connection Profile tests', () => {


    setup(() => {
        // No setup currently needed
    });

    test('CreateProfile asks correct questions', () => {
        // Given
        let prompter: TypeMoq.Mock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        let answers: {[key: string]: string} = {};
        let profileQuestions: IQuestion[];
        let profileReturned: IConnectionProfile;

        // When createProfile is called and user cancels out
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                .callback(questions => {
                    // Capture questions for verification
                    profileQuestions = questions;
                })
                .returns(questions => {
                    //
                    return Promise.resolve(answers);
                });

        ConnectionProfile.createProfile(prompter.object)
            .then(profile => profileReturned = profile);

        // Then expect the following flow:
        let questionNames: string[] = [
            Constants.serverPrompt,     // Server
            Constants.databasePrompt,   // DB Name
            Constants.authTypePrompt,   // Authentication Type
            Constants.usernamePrompt,   // UserName
            Constants.passwordPrompt,   // Password
            Constants.msgSavePassword,  // Save Password
            Constants.profileNamePrompt // Profile Name
        ];

        assert.equal(profileQuestions.length, questionNames.length, 'unexpected number of questions');
        for (let i = 0; i < profileQuestions.length; i++) {
            assert.equal(profileQuestions[i].name, questionNames[i], `Missing question for ${questionNames[i]}`);
        }
        // And expect result to be undefined as questions were not answered
        assert.equal(profileReturned, undefined);
    });

});
