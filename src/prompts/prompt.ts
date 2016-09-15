'use strict';

// This code is originally from https://github.com/DonJayamanne/bowerVSCode
// License: https://github.com/DonJayamanne/bowerVSCode/blob/master/LICENSE

abstract class Prompt {

    protected _question: any;

    constructor(question: any) {
        this._question = question;
    }

    public abstract render(): any;
}

export default Prompt;
