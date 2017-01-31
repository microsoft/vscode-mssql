var builder = require('xmlbuilder')
var xpath = require('xpath')
var dom = require('xmldom').DOMParser
var gulp = require('gulp')
var config = require('./config')
var through = require('through2')
var path = require('path')


let testDictionary = {
    "myKey": "my key in english",
    "myOtherKey": "my second key in english"
}


function convertJsonToDictionary(jsonInput) {

}

function convertXmlToDictionary(xmlInput) {

}

function convertDictionaryToJson(dict) {
    let base = builder.create({
        xliff: {
            "@xmlns": "urn:oasis:names:tc:xliff:document:1.2",
            "@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            "@xsi:schemaLocation": "urn:oasis:names:tc:xliff:document:1.2 xliff-core-1.2-transitional.xsd",
            "@version": "1.2",
            file: {
                "@source-language": "en-US",
                "@target-language": "es",
                "@datatype": "xml",
                body: {
                }
            }
        }
    });

    for(var key in dict) {
        var value = dict[value];
        base.ele('trans-unit', { 'id': key})
            .ele('source', {'xml:lang':"en-US"}, "test_content")
            .up().ele('target', {'xml:lang':'es'}, value);
    }

    return base.end()

}

function convertDictionaryToXml(dict) {

}

// Import *.xlf
gulp.task('localTest', function () {
    return gulp.src([config.paths.project.localization + '**/*.xlf'])
    .pipe(through.obj(function (file, enc, callback) {
        var bundle, bundlePath;
        var base = path.basename(file.path, '.xlf').match(/^(.*)[.]([^.]*)$/);
        var doc = new dom().parseFromString(String(file.contents));
        var nodes = xpath.select("//trans-unit", doc)
        for(var elem in nodes) {
            console.log(elem.toString());
        }
        console.log(nodes);
        /*
        var data = JSON.parse(file.contents);
        if (base) {
            try {
                bundlePath = config.paths.project.localization + '\\i18n\\esn\\constants\\localizedConstants.i18n.json';
                bundle = JSON.parse(stripBom(fs.readFileSync(bundlePath, 'utf8')));
                console.log(bundle);
                xliffConv.parseXliff(xliff, { bundle: bundle }, function (output) {
                    file.contents = new Buffer(JSONstringify(output, null, 2));
                    file.path = bundlePath;
                });
            }
            catch (ex) {
                console.log(ex);
                callback(null, file);
            }
        } else {
            callback(null, file);
        }*/
    }))
    .pipe(gulp.dest(config.paths.project.localization));
});

/*
<?xml version="1.0" encoding="utf-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:oasis:names:tc:xliff:document:1.2 xliff-core-1.2-transitional.xsd" version="1.2">
  <file original="extension.i18ntest.JSON" source-language="en-US" target-language="es" datatype="xml">
    <body>
      <trans-unit id="recentConnectionsPlaceholder">
        <source xml:lang="en-US">test_english</source>
        <target xml:lang="es">test_spanish</target>
      </trans-unit>
    </body>
  </file>
</xliff>
*/