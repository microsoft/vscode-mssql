var gulp = require('gulp');
var upload = require('gulp-upload');

gulp.task('appveyor:uploadTestResults', () => {
    var resultsType = '';
    var jobId = process.env.APPVEYOR_JOB_ID;
    var options = {
        server: 'https://ci.appveyor.com/api/testresults/xunit/' + jobId
    }
    return gulp.src('test-reports/*')
                .pipe(upload(options));
});