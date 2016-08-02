var gulp = require('gulp');
var tslint = require('gulp-tslint');
var ts = require('gulp-typescript');
var del = require('del');
var srcmap = require('gulp-sourcemaps');
var config = require('./config')
var less = require('gulp-less');
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

gulp.task('html:compile-ts', () => {
    return gulp.src([
            config.paths.html.root + '/src/**/*.ts',
            config.paths.html.root + '/typings/**/*.d.ts'])
            .pipe(ts(tsProject))
});

gulp.task('html:compile-css', () => {
    return gulp.src(config.paths.html.root + 'src/**/*.less')
            .pipe(less())
            .pipe(gulp.dest(config.paths.html.root) + '/out/')
})

gulp.task('html:compile', gulp.series('html:compile-ts'))

gulp.task('html:copy', () => {
    return gulp.src(config.paths.html.root + '/src/**/*')
            .pipe(gulp.dest('/out/views/htmlcontent/'))
})

gulp.task('html:build', gulp.series('html:compile'));

gulp.task('html:clean', () => {
    return del(config.paths.html.root + '/out');
});

gulp.task('build-html', gulp.series('html:tslint', 'html:build'));

gulp.task('html:watch', function(){
    return gulp.watch(config.paths.html.root + '/src/**/*', gulp.series('html:tslint'))
})