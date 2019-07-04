const path = require('path');
const minimatch = require('minimatch');
const fs = require('fs-extra');

// An enum-like list of constants. Exposed to the sarcina module.
const OptionConstants = {
    REMOVE_ALL: 0,
    REMOVE_BUNDLED: 1,
    KEEP_ALL: 2,
    KEEP_NECESSARY: 3,

    KEEP: 0,
    REMOVE: 1,

    ES3: 0,
    ES5: 1,
    ES6: 2,
    ES2015: 2, // Same as ES6
    ES2016: 3,
    ES2017: 4,
    ESNEXT: 5,

    LOCAL: 0,
    START_OF_HEAD: 1,
    END_OF_HEAD: 2,
    START_OF_BODY: 3,
    END_OF_BODY: 4,
    START_OF_DOCUMENT: 5,
    END_OF_DOCUMENT: 6,
    START_OF_FILE: 7,
    END_OF_FILE: 8
};
const DEFAULT_OPTIONS = {
    // General options
    src: path.resolve('./src'), // Path to input directory
    dist: path.resolve('./dist'), // Path to output directory
    minifyHtml: true, // Minify HTML
    randomBundleNames: true, // 'true' = random hex names, 'false' = numbered bundles

    // CSS-related options
    bundleCss: true, // Bundle CSS
    cssInsertPosition: OptionConstants.END_OF_HEAD, // Where to insert bundles
    minifyCss: true, // Minify CSS
    optimizeCss: false, // Optimize CSS
    autoprefixCss: false, // Add vendor prefixes
    handleInlineCss: true, // Handle CSS inside <style> tags
    injectCss: false, // Don't create bundle files, instead inject CSS directly into markup
    sanitizeInjectedCss: true, // Turn certain characters into their unicode representation, so that HTML doesn't get messed up
    cssFileAction: OptionConstants.KEEP_NECESSARY, // How to handle .css files
    missingCssFileTagAction: OptionConstants.KEEP, // What do with <link> elements pointing to a missing local file
    handledCssFiles: [], // CSS files to be processed separate from any markup

    // Script-related options
    bundleScript: true, // Bundle JS
    scriptInsertPosition: OptionConstants.LOCAL, // Where to insert bundles
    minifyScript: true, // Minify JS
    transpileScript: false, // Transpile JS to earlier versions
    iifeScript: false, // Wrap every bundle in an IIFE
    insertPolyfill: false, // Insert a Polyfill.io script to the start of the <head>
    handleInlineScript: true, // Handle JS inside <script> tag
    injectScript: false, // Don't create bundle files, instead inject JS directly into markup
    sanitizeInjectedScript: true, // Turn certain characters into their unicode represenation, so that HTML doesn't get messed up
    scriptFileAction: OptionConstants.KEEP_NECESSARY, // How to handle .js files
    missingScriptFileTagAction: OptionConstants.KEEP, // What to do with <script> elements pointing to a missing local file
    uglifyOptionsOverride: null, // Override for UglifyES JavaScript minification,
    handledScriptFiles: [], // Scripts to be processed separate from any markup
    handledModuleFiles: [], // Scripts to be processed as ES6 modules separate from any markup,

    // File-related options
    removeEmptyDirectories: true, // Remove empty directories
    keep: [], // List of globs, files to keep
    ignore: [], // List of globs, file to ignore and to not copy
    ignoreGit: true, // Ignore git-related files
    ignoreDsStore: true, // Ignore DSStore
    
    // Other options
    verbose: false, // Print bundling progress
};
const MINIMATCH_OPTIONS = {matchBase: true, dot: true}; // The options used by minimatch for glob-matching

class BundlerOptions {
    constructor(override) {
        for (let key in DEFAULT_OPTIONS) {
            this[key] = DEFAULT_OPTIONS[key];
        }

        this.init(override);
    }

    init(override) {
        if (typeof override === 'object') {
            for (let key in override) {
                if (this[key] === undefined) continue;
                this[key] = override[key];
            }
        }

        if (!fs.existsSync(this.src)) {
            throw new Error(`Given source directory "${this.src}" does not exist.`);
        }

        this.src = path.resolve(this.src);
        this.dist = path.resolve(this.dist);

        if (this.ignoreGit) this.ignore.push('*.gitignore', '*.git');
        if (this.ignoreDsStore) this.ignore.push('*.DS_Store');

        /* Init minimatch instances */

        this.keepMinimatches = [];
        this.ignoreMinimatches = [];
        this.handledCssFilesMinimatches = [];
        this.handledScriptFilesMinimatches = [];
        this.handledModuleFilesMinimatches = [];

        for (let pattern of this.keep) {
            this.keepMinimatches.push(new minimatch.Minimatch(pattern, MINIMATCH_OPTIONS));
        }
        for (let pattern of this.ignore) {
            this.ignoreMinimatches.push(new minimatch.Minimatch(pattern, MINIMATCH_OPTIONS));
        }
        if (Array.isArray(this.handledCssFiles)) {
            for (let pattern of this.handledCssFiles) {
                this.handledCssFilesMinimatches.push(new minimatch.Minimatch(pattern, MINIMATCH_OPTIONS));
            }
        }
        if (Array.isArray(this.handledScriptFiles)) {
            for (let pattern of this.handledScriptFiles) {
                this.handledScriptFilesMinimatches.push(new minimatch.Minimatch(pattern, MINIMATCH_OPTIONS));
            }
        }
        if (Array.isArray(this.handledModuleFiles)) {
            for (let pattern of this.handledModuleFiles) {
                this.handledModuleFilesMinimatches.push(new minimatch.Minimatch(pattern, MINIMATCH_OPTIONS));
            }
        }
    }

    // Returns true if the given path is matched by a minimatch
    pathShouldBeKept(relativePath) {
        for (let minimatch of this.keepMinimatches) {
            if (minimatch.match(relativePath)) return true;
        }
    
        return false;
    }

    // Returns true if the given path is matched by a minimatch
    pathIsIgnored(relativePath) {
        if (this.pathShouldBeKept(relativePath)) return false;

        for (let minimatch of this.ignoreMinimatches) {
            if (minimatch.match(relativePath)) return true;
        }
    
        return false;
    }

    cssFileShouldBeHandled(file) {
        if (this.handledCssFiles === 'all') {
            return true;
        }

        let relativePath = file.getRelativePath();

        for (let minimatch of this.handledCssFilesMinimatches) {
            if (minimatch.match(relativePath)) return true;
        }

        return false;
    }

    scriptFileShouldBeHandled(file) {
        if (this.handledScriptFiles === 'all') {
            return true;
        }

        let relativePath = file.getRelativePath();

        for (let minimatch of this.handledScriptFilesMinimatches) {
            if (minimatch.match(relativePath)) return true;
        }

        return false;
    }

    moduleFileShouldBeHandled(file) {
        let relativePath = file.getRelativePath();

        for (let minimatch of this.handledModuleFilesMinimatches) {
            if (minimatch.match(relativePath)) return true;
        }

        return false;
    }
}

function getTargetDataFromInsertPosition(insertPosition) {
    let element, position;

    switch (insertPosition) {
        case OptionConstants.START_OF_HEAD: case OptionConstants.START_OF_BODY: case OptionConstants.START_OF_DOCUMENT: case OptionConstants.START_OF_FILE: {
            position = 'start';
        }; break;
        default: {
            position = 'end';
        }
    }

    switch (insertPosition) {
        case OptionConstants.START_OF_HEAD: case OptionConstants.END_OF_HEAD: {
            element = 'head';
        }; break;
        case OptionConstants.START_OF_BODY: case OptionConstants.END_OF_BODY: {
            element = 'body';
        }; break;
        case OptionConstants.START_OF_DOCUMENT: case OptionConstants.END_OF_DOCUMENT: {
            element = 'document';
        }; break;
        default: {
            element = 'file';
        }
    }

    return {
        element, position
    };
}

exports.OptionConstants = OptionConstants;
exports.BundlerOptions = BundlerOptions;
exports.getTargetDataFromInsertPosition = getTargetDataFromInsertPosition;