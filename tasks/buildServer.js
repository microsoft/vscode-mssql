var gulp = require('gulp');
var upload = require('gulp-upload');
var fs = require('fs');
var parht = require('path');

gulp.task('appveyor:uploadTestResults', () => {
    var resultsType = '';
    var jobId = process.env.APPVEYOR_JOB_ID;
    var options = {
        server: 'https://ci.appveyor.com/api/testresults/xunit/' + jobId,
        data: {
            fileName: function(file) {
                console.log('file: ' + file.path);
                return path.relative(__dirname, file.path)
            }
        },
        callback: function (err, data, res) {
            if (err) {
                console.log('error:' + err.toString());
            } else {
                console.log(data.toString());
            }
        }
    }
    var root = path.resolve(path.dirname(__dirname));
    var testreports = path.resolve(root, 'test-reports');
    console.log('root ' + root);
    console.log('test reports' + testreports);
    try {
        fs.accessSync(testreports, fs.F_OK);
        return gulp.src(testreports + '/*')
                    .pipe(upload(options));
    } catch (e) {
        console.log('files do not exists');
    }
});