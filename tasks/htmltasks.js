var gulp = require('gulp');
var tslint = require('gulp-tslint');
var ts = require('gulp-typescript');
var del = require('del');
var srcmap = require('gulp-sourcemaps');
var config = require('./config')
var tsProject = ts.createProject(config.paths.html.root + '/tsconfig.json');

gulp.task('html:tslint', () => {
    return gulp.src([
        config.paths.html.root + '/src/**/*.ts'
    ])
    .pipe((tslint({
        formatter: "verbose"
    })))
    .pipe(tslint.report());
});

gulp.task('html:compile', () => {
    return gulp.src([
            config.paths.html.root + '/src/**/*.ts',
            config.paths.html.root + '/typings/underscore.d.ts'])
            .pipe(srcmap.init())
            .pipe(ts(tsProject))
            .pipe(srcmap.write('.'))
            .pipe(gulp.dest(config.paths.html.root + '/out/'));
});

gulp.task('html:copy', () => {
    return gulp.src(config.paths.html.root + '/src/sqlOutput.ejs')
            .pipe(gulp.dest(config.paths.html.root + '/out/'))
})

gulp.task('html:build', gulp.series('html:compile', 'html:copy'));

gulp.task('html:clean', () => {
    return del(config.paths.html.root + '/out');
});

gulp.task('build-html', gulp.series('html:tslint'));

gulp.task('html:watch', function(){
    return gulp.watch(config.paths.html.root + '/src/**/*', gulp.series('html:tslint'))
})