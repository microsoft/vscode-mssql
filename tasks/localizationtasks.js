let builder = require('xmlbuilder')
var dom = require('xmldom').DOMParser
var gulp = require('gulp')
var config = require('./config')
var through = require('through2')
var path = require('path')


// converts a json object into xml
function convertDictionaryToXml(dict) {
    //TODO: for reverse file sync (if ever needed)
}

// converts a json object into a plain text json
function convertDictionaryToJson(dict) {
    return JSON.stringify(dict, null, '\t') + '\n';
}

// converts an xml file into a json object
function convertXmlToDictionary(xmlInput) {
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
            source = escapeChars(sourceElement[0].textContent);
        }

        // Extract target element if possible
        let targetElement = unit.getElementsByTagName('target');
        let target = '';
        if(targetElement.length >= 1){
            target = escapeChars(targetElement[0].textContent);
        }

        // Return json with {id:{target,source}} format
        dict[id] = {'source': source, 'target': target};
    }

    return dict;
}

// Escapes all characters which need to be escaped (')
function escapeChars(input) {
    return input.replace(/'/g, "\\'");
}

// converts plain text json into a json object
function convertJsonToDictionary(jsonInput) {
    return JSON.parse(jsonInput);
}

// export json files from *.xlf
// mirrors the file paths and names
gulp.task('ext:localization:xliff-to-json', function () {
    return gulp.src([config.paths.project.localization + '/xliff/**/*.xlf', '!' + config.paths.project.localization + '/xliff/enu/**/*.xlf'])
    .pipe(through.obj(function (file, enc, callback) {

        // convert xliff into json document
        let dict = convertXmlToDictionary(String(file.contents));
        Object.keys(dict).map(function(key, index) {
            dict[key] = dict[key]['target']
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
