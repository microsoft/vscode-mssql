var gulp = require('gulp');
var upload = require('gulp-file-post');
var fs = require('fs');

gulp.task('appveyor:uploadTestResults', () => {
    var resultsType = '';
    var jobId = process.env.APPVEYOR_JOB_ID;
    var options = {
        url: 'https://ci.appveyor.com/api/testresults/xunit/' + jobId
    }
    console.log('Uploading to ', options.url);
    return gulp.src('../test-reports/*')
                .pipe(upload(options));
});