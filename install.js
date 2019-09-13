var gulp = require('gulp');
var install = require('gulp-install');

gulp.task('install', function(){
    return gulp.src(['./package.json'])
                    .pipe(install());
});