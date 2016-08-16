import {Injectable} from '@angular/core';
import Localization = require('./Localization');

@Injectable()
export class LocalizationService {
    locale: Localization;

    setLocale(locale: Localization): void {
        this.locale = locale;

        // fold the top level string collections up into this class
        for (let p in locale) {
            if (locale.hasOwnProperty(p)) {
                this[p] = locale[p];
            }
        }
    }
}
