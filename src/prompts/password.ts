'use strict';

// This code is originally from https://github.com/DonJayamanne/bowerVSCode
// License: https://github.com/DonJayamanne/bowerVSCode/blob/master/LICENSE
import InputPrompt from './input';

export default class PasswordPrompt extends InputPrompt {

    constructor(question: any) {
        super(question);

        this._options.password = true;
    }
}
