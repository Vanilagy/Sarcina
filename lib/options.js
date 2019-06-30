const path = require('path');
const minimatch = require('minimatch');
const fs = require('fs-extra');

// An enum-like list of constants. Exposed to the sarcina module.
const OptionConstants = {
    REMOVE_ALL: 0,
    REMOVE_BUNDLED: 1,
    KEEP_ALL: 2,

    KEEP: 0,
    REMOVE: 1,

    ES3: 0,
    ES5: 1,
    ES6: 2,
    ES2015: 2, // Same as ES6
    ES2016: 3,
    ES2017: 4,
    ESNEXT: 5
};
const DEFAULT_OPTIONS = {
    // General options
    src: path.resolve('./src'), // Path to input directory
    dist: path.resolve('./dist'), // Path to output directory
    minifyHtml: true, // Minify HTML
    randomBundleNames: true, // 'true' = random hex names, 'false' = numbered bundles

    // CSS-related options
    bundleCss: true, // Bundle CSS. If false, CSS won't be processed at all
    minifyCss: true, // Minify CSS
    optimizeCss: false, // Optimize CSS
    autoprefixCss: false, // Add vendor prefixes
    handleInlineCss: true, // Handle CSS inside <style> tags
    injectCss: false, // Don't create bundle files, instead inject CSS directly into markup
    sanitizeInjectedCss: true, // Turn certain characters into their unicode representation, so that HTML doesn't get messed up
    cssFileAction: OptionConstants.REMOVE_BUNDLED, // Jow to handle .css files
    missingCssFileTagAction: OptionConstants.KEEP, // What do with <link> elements pointing to a missing local file

    // Script-related options
    bundleScript: true, // Bundle JS. If false, JS won't be processed at all
    minifyScript: true, // Minify JS
    transpileScript: false, // Transpile JS to earlier versions
    iifeScript: false, // Wrap every bundle in an IIFE
    handleInlineScript: true, // Handle JS inside <script> tag
    injectScript: false, // Don't create bundle files, instead inject JS directly into markup
    sanitizeInjectedScript: true, // Turn certain characters into their unicode represenation, so that HTML doesn't get messed up
    scriptFileAction: OptionConstants.REMOVE_BUNDLED, // How to handle .js files
    missingScriptFileTagAction: OptionConstants.KEEP, // What to do with <script> elements pointing to a missing local file
    uglifyOptionsOverride: null, // Override for UglifyES JavaScript minifaction

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

        /* Init minimatch instances */

        this.keepMinimatches = [];
        this.ignoreMinimatches = [];

        for (let pattern of this.keep) {
            this.keepMinimatches.push(new minimatch.Minimatch(pattern, MINIMATCH_OPTIONS));
        }
        for (let pattern of this.ignore) {
            this.ignoreMinimatches.push(new minimatch.Minimatch(pattern, MINIMATCH_OPTIONS));
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
        for (let minimatch of this.ignoreMinimatches) {
            if (minimatch.match(relativePath)) return true;
        }
    
        return false;
    }
}

exports.OptionConstants = OptionConstants;
exports.BundlerOptions = BundlerOptions;