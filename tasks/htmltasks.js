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
            .pipe(gulp.dest(config.paths.project.root + '/out/src/views/htmlcontent/src/'))
});

gulp.task('html:compile-css', () => {
    return gulp.src(config.paths.html.root + 'src/**/*.less')
            .pipe(less())
            .pipe(gulp.dest(config.paths.html.root) + '/out/')
})

gulp.task('html:compile', gulp.series('html:compile-ts'))

gulp.task('html:copy_node_modules', () => {
    return gulp.src(config.includes.html.node_modules, {base: config.paths.html.root + '/node_modules/'})
               .pipe(gulp.dest(config.paths.project.root + '/out/src/views/htmlcontent/src/node_modules/'))
})

gulp.task('html:copy_src', () => {
    return gulp.src([
                        config.paths.html.root + '/src/**/*.html',
                        config.paths.html.root + '/src/**/*.ejs',
                        config.paths.html.root + '/src/**/*.js',
                        config.paths.html.root + '/src/**/*.css',
                        config.paths.html.root + '/src/**/*.svg'
                    ])
                .pipe(gulp.dest(config.paths.project.root + '/out/src/views/htmlcontent/src/'))
})

gulp.task('html:copy', gulp.series('html:copy_src','html:copy_node_modules'));

gulp.task('html:build', gulp.series('html:compile'));

gulp.task('html:clean', () => {
    return del(config.paths.html.root + '/out');
});

gulp.task('build-html', gulp.series('html:tslint', 'html:build', 'html:copy'));

gulp.task('html:watch', function(){
    return gulp.watch(config.paths.html.root + '/src/**/*', gulp.series('html:tslint'))
})