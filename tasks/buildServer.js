var gulp = require('gulp');
var upload = require('gulp-upload');
var fs = require('fs');

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
    try {
        fs.accessSync('./test-reports/', fs.F_OK);
        return gulp.src('./test-reports/*')
                    .pipe(upload(options));
    } catch (e) {
        console.log('files do not exists');
    }
});