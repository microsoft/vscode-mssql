var dom = require('xmldom').DOMParser
var gulp = require('gulp')
var config = require('./config')
var through = require('through2')
var packageAllKeys = require('./../package.nls.json')

const iso639_3_to_2 = {
   chs: 'zh-cn',
   cht: 'zh-tw',
   csy: 'cs-cz',
   deu: 'de',
   enu: 'en',
   esn: 'es',
   fra: 'fr',
   hun: 'hu',
   ita: 'it',
   jpn: 'ja',
   kor: 'ko',
   nld: 'nl',
   plk: 'pl',
   ptb: 'pt-br',
   ptg: 'pt',
   rus: 'ru',
   sve: 'sv-se',
   trk: 'tr'
 };


// converts a json object into a plain text json
function convertDictionaryToJson(dict) {
    return JSON.stringify(dict, null, '\t') + '\n';
}

// converts an xml file into a json object
function convertXmlToDictionary(xmlInput, escapeChar = true) {
    let xmlDom = new dom().parseFromString(xmlInput);
    let transUnits = xmlDom.getElementsByTagName('trans-unit');
    let dict = {};
    for (var i = 0; i < transUnits.length; ++i) {
        let unit = transUnits[i];

        // Extract ID attribute
        let id = unit.getAttribute('id');

        // Extract source element if possible
        let sourceElement = unit.getElementsByTagName('source');
        let source = '';
        if (sourceElement.length >= 1) {
            source = escapeChars(sourceElement[0].textContent, escapeChar);
        }

        // Extract target element if possible
        let targetElement = unit.getElementsByTagName('target');
        let target = '';
        if(targetElement.length >= 1){
            target = escapeChars(targetElement[0].textContent, escapeChar);
        }

        // Return json with {id:{target,source}} format
        dict[id] = {'source': source, 'target': target};
    }

    return dict;
}

// Escapes all characters which need to be escaped (')
function escapeChars(input, escapeChar = true) {
    if (escapeChar) {
        return input.replace(/'/g, "\\'");
    } else {
        return input;
    }
}

// converts plain text json into a json object
function convertJsonToDictionary(jsonInput) {
    return JSON.parse(jsonInput);
}

// export json files from *.xlf
// mirrors the file paths and names
gulp.task('ext:localization:xliff-to-json', function () {
    return gulp.src([config.paths.project.localization + '/xliff/**/*.xlf', '!' + config.paths.project.localization + '/xliff/enu/**/*.xlf', '!' +
    config.paths.project.localization + '/xliff/**/*localizedPackage.json.*.xlf'])
    .pipe(through.obj(function (file, enc, callback) {

        // convert xliff into json document
        let dict = convertXmlToDictionary(String(file.contents));
        Object.keys(dict).map(function(key, index) {
            let target = dict[key]['target'];
            if (target) {
                dict[key] = target;
            } else {
                // Fall back to English
                dict[key] = dict[key]['source'];
            }
        });
        file.contents = new Buffer(convertDictionaryToJson(dict));

        // modify file extensions to follow proper convention
        file.basename = file.basename.substr(0, file.basename.indexOf('.')) + '.i18n.json';

        // callback to notify we have completed the current file
        callback(null, file);
    }))
    .pipe(gulp.dest(config.paths.project.localization + '/i18n/'));
});

// Generates a localized constants file from the en xliff file
gulp.task('ext:localization:xliff-to-ts', function () {
    return gulp.src([config.paths.project.localization + '/xliff/enu/constants/localizedConstants.enu.xlf'])
    .pipe(through.obj(function (file, enc, callback) {
        // convert xliff into json document
        let dict = convertXmlToDictionary(String(file.contents));
        var contents = ['/* tslint:disable */',
            '// THIS IS A COMPUTER GENERATED FILE. CHANGES IN THIS FILE WILL BE OVERWRITTEN.',
            '// TO ADD LOCALIZED CONSTANTS, ADD YOUR CONSTANT TO THE ENU XLIFF FILE UNDER ~/localization/xliff/enu/constants/localizedConstants.enu.xlf AND REBUILD THE PROJECT',
            'import * as nls from \'vscode-nls\';'];
        for (var key in dict) {
            if (dict.hasOwnProperty(key)) {
                let instantiation = 'export let ' + key + ' = \'' + dict[key]['source'] + '\';';
                contents.push(instantiation);
            }
        }

        // add headers to export localization function
        contents.push('export let loadLocalizedConstants = (locale: string) => {');
        contents.push('\tlet localize = nls.config({ locale: locale })();');
        // Re-export each constant
        for (var key in dict) {
            if (dict.hasOwnProperty(key)) {
                let instantiation = '\t' + key + ' = localize(\'' + key + '\', \'' + dict[key]['source'] + '\');';
                contents.push(instantiation);
            }
        }
        // end the function
        contents.push('};');

        // Join with new lines in between
        let fullFileContents = contents.join('\r\n') + '\r\n';
        file.contents = new Buffer(fullFileContents);

        // Name our file
        file.basename = 'localizedConstants.ts';

        // callback to notify we have completed the current file
        callback(null, file);
    }))
    .pipe(gulp.dest(config.paths.project.root + '/src/constants/'));
});

// Generates a localized package.nls.*.json
gulp.task('ext:localization:xliff-to-package.nls', function () {
    return gulp.src([config.paths.project.localization + '/xliff/**/localizedPackage.json.*.xlf', '!' + config.paths.project.localization + '/xliff/enu/localizedPackage.json.enu.xlf'],  { base: '' })
    .pipe(through.obj(function (file, enc, callback) {
        // convert xliff into json document
        let dict = convertXmlToDictionary(String(file.contents), false);

        var contents = ['{'];
        var regxForReplacingQuots = new RegExp('"', 'g');

        // Get all the keys from package.nls.json which is the English version and get the localized value from xlf
        // Use the English value if not translated, right now there's no fall back to English if the text is not localized.
        // So all the keys have to exist in all package.nls.*.json
        Object.keys(packageAllKeys).forEach(key => {
            let value = packageAllKeys[key];
            if (contents.length >= 2) {
                contents[contents.length - 1] += ',';
            }
            if (dict.hasOwnProperty(key)) {

                value = dict[key]['target'];
            }
            if (value === '') {
                value = packageAllKeys[key];
            }

            if(value && value.indexOf('"') >= 0) {
                value = value.replace(regxForReplacingQuots, '\'');
            }
            let instantiation = '"' + key + '":"' + value + '"';
            contents.push(instantiation);

        });

        // end the function
        contents.push('}');

        // Join with new lines in between
        let fullFileContents = contents.join('\r\n') + '\r\n';
        file.contents = new Buffer(fullFileContents);

        let indexToStart = 'localizedPackage.json.'.length + 1;
        let languageIndex = file.basename.indexOf('.', indexToStart);
        let language = file.basename.substr(indexToStart - 1, (languageIndex - indexToStart) + 1);

        // Name our file
        if (language === 'enu') {
            file.basename = 'package.nls.json';
        } else {
            file.basename = 'package.nls.' + iso639_3_to_2[language] +'.json';
        }

        // Make the new file create on root
        file.dirname = file.dirname.replace(language , '');

        // callback to notify we have completed the current file
        callback(null, file);
    }))
    .pipe(gulp.dest(config.paths.project.root));
});
