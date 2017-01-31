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
        let id = unit.getAttribute('id');
        let source = unit.getElementsByTagName('source')[0].textContent;
        let target = unit.getElementsByTagName('target')[0].textContent;
        dict[id] = target;
    }

    return dict;
}

// converts plain text json into a json object
function convertJsonToDictionary(jsonInput) {
    return JSON.parse(jsonInput);
}

// export json files from *.xlf
// mirrors the file paths and names
gulp.task('import-xliff', function () {
    return gulp.src([config.paths.project.localization + '/xliff/**/*.xlf'])
    .pipe(through.obj(function (file, enc, callback) {

        // convert cliff into json document
        let dict = convertXmlToDictionary(String(file.contents));
        file.contents = new Buffer(convertDictionaryToJson(dict));

        // modify file extensions to follow proper convention
        file.basename = file.basename.substr(0, file.basename.indexOf('.')) + '.i18n.json';

        // callback to notify we have completed the current file
        callback(null, file);
    }))
    .pipe(gulp.dest(config.paths.project.localization + '/i18n/'));
});