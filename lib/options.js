const path = require('path');
const minimatch = require('minimatch');
const fs = require('fs-extra');

const util = require('./util.js');

const FileActions = {
    REMOVE_ALL: 0,
    REMOVE_BUNDLED: 1,
    KEEP_ALL: 2,
    KEEP_NECESSARY: 3,
};
const MissingFileTagActions = {
    KEEP: 10,
    REMOVE: 11,
};
const EcmascriptVersions = {
    ES3: 20,
    ES5: 21,
    ES6: 22,
    ES2015: 22, // Same as ES6
    ES2016: 23,
    ES2017: 24,
    ESNEXT: 25,
};
const InsertPositions = {
    LOCAL: 30,
    START_OF_HEAD: 31,
    END_OF_HEAD: 32,
    START_OF_BODY: 33,
    END_OF_BODY: 34,
    START_OF_DOCUMENT: 35,
    END_OF_DOCUMENT: 36,
    START_OF_FILE: 37,
    END_OF_FILE: 38
};

// An enum-like list of all option constants. Exposed to the sarcina module.
const OptionConstants = {};
Object.assign(OptionConstants, FileActions, MissingFileTagActions, EcmascriptVersions, InsertPositions);

const invalidityCheckerInsertPosition = (value, name) => {
    if (!util.objectHasValue(InsertPositions, value)) {
        return name + ' has to be one of the following: ' + Object.keys(InsertPositions).join(', ') + '.';
    }
};
const invalidityCheckerFileAction = (value, name) => {
    if (!util.objectHasValue(FileActions, value)) {
        return name + ' has to be one of the following: ' + Object.keys(FileActions).join(', ') + '.';
    }
};
const invalidityCheckerMissingFileTagAction = (value, name) => {
    if (!util.objectHasValue(MissingFileTagActions, value)) {
        return name + ' has to be one of the following: ' + Object.keys(MissingFileTagActions).join(', ') + '.';
    }
};
const invalidityCheckerGlobArray = (value, name) => {
    if (!Array.isArray(value)) return name + " has to be an array of strings.";
    if (value.find((a) => typeof a !== 'string')) return name + ' has to be an array of strings.';
};
const invalidityCheckerGlobArrayWithAll = (value, name) => {
    if (value === 'all') return;
    if (!Array.isArray(value)) return name + " has to be either 'all' or an array of strings.";
    if (value.find((a) => typeof a !== 'string')) return name + ' has to be an array of strings.';
};
const invalidityCheckerUglifyOptionsOverride = (value, name) => {
    if (value !== null && !util.isPlainObject(value)) return name + ' has to be either null or an object.';
};

const DEFAULT_OPTIONS = {
    // General options
    src: path.resolve('./src'), // Path to input directory
    dist: path.resolve('./dist'), // Path to output directory
    minifyHtml: true, // Minify HTML
    randomBundleNames: true, // 'true' = random hex names, 'false' = numbered bundles

    // CSS-related options
    bundleCss: true, // Bundle CSS
    cssInsertPosition: { // Where to insert bundles
        default: InsertPositions.END_OF_HEAD,
        getInvalidity: invalidityCheckerInsertPosition
    },
    minifyCss: true, // Minify CSS
    optimizeCss: false, // Optimize CSS
    autoprefixCss: false, // Add vendor prefixes
    handleInlineCss: true, // Handle CSS inside <style> tags
    injectCss: false, // Don't create bundle files, instead inject CSS directly into markup
    sanitizeInjectedCss: true, // Turn certain characters into their unicode representation, so that HTML doesn't get messed up
    cssFileAction: { // How to handle .css files
        default: FileActions.KEEP_NECESSARY,
        getInvalidity: invalidityCheckerFileAction
    },
    missingCssFileTagAction: { // What do with <link> elements pointing to a missing local file
        default: MissingFileTagActions.KEEP,
        getInvalidity: invalidityCheckerMissingFileTagAction
    },
    handledCssFiles: { // CSS files to be processed separate from any markup
        default: [],
        getInvalidity: invalidityCheckerGlobArrayWithAll
    }, 

    // Script-related options
    bundleScript: true, // Bundle JS
    scriptInsertPosition: { // Where to insert bundles
        default: InsertPositions.LOCAL,
        getInvalidity: invalidityCheckerInsertPosition
    },
    minifyScript: true, // Minify JS
    transpileScript: false, // Transpile JS to earlier versions
    iifeScript: false, // Wrap every bundle in an IIFE
    insertPolyfill: false, // Insert a Polyfill.io script to the start of the <head>
    handleInlineScript: true, // Handle JS inside <script> tag
    injectScript: false, // Don't create bundle files, instead inject JS directly into markup
    sanitizeInjectedScript: true, // Turn certain characters into their unicode represenation, so that HTML doesn't get messed up
    scriptFileAction: { // How to handle .js files
        default: FileActions.KEEP_NECESSARY,
        getInvalidity: invalidityCheckerFileAction
    },
    missingScriptFileTagAction: { // What to do with <script> elements pointing to a missing local file
        default: MissingFileTagActions.KEEP,
        getInvalidity: invalidityCheckerMissingFileTagAction
    },
    uglifyOptionsOverride: { // Override for UglifyES JavaScript minification
        default: null,
        getInvalidity: invalidityCheckerUglifyOptionsOverride
    }, 
    handledScriptFiles: { // Scripts to be processed separate from any markup
        default: [],
        getInvalidity: invalidityCheckerGlobArrayWithAll
    },
    handledModuleFiles: { // Scripts to be processed as ES6 modules separate from any markup
        default: [],
        getInvalidity: invalidityCheckerGlobArray
    },

    // File-related options
    removeEmptyDirectories: true, // Remove empty directories
    keep: { // List of globs, files to keep
        default: [],
        getInvalidity: invalidityCheckerGlobArray
    },
    ignore: { // List of globs, file to ignore and to not copy
        default: [],
        getInvalidity: invalidityCheckerGlobArray
    },
    ignoreGit: true, // Ignore git-related files
    ignoreDsStore: true, // Ignore DSStore
    
    // Other options
    verbose: false, // Print bundling progress
};

const MINIMATCH_OPTIONS = {matchBase: true, dot: true}; // The options used by minimatch for glob-matching

class BundlerOptions {
    constructor(override) {
        this.adoptDefaultOptions();
        this.init(override);
    }

    adoptDefaultOptions() {
        for (let key in DEFAULT_OPTIONS) {
            let value = DEFAULT_OPTIONS[key];

            if (!util.isPlainObject(value)) {
                this[key] = value;
            } else {
                this[key] = value.default;
            }
        }
    }

    init(override) {
        /* Validate */

        let validationError = null;
        for (let key in override) {
            let value = override[key];
            let defaultValue = DEFAULT_OPTIONS[key];

            if (defaultValue === undefined) continue;

            // Being a plain object indicates a custom validity check. Not being an option means checking against the type of the default value.
            if (!util.isPlainObject(defaultValue)) {
                if (typeof value !== typeof defaultValue) {
                    validationError = `${key} has to be of type ${typeof defaultValue}.`;
                    break;
                }
            } else {
                let customError = defaultValue.getInvalidity(value, key);
                if (customError) {
                    validationError = customError;
                    break;
                }
            }
        }
        if (validationError) {
            throw new Error('Incorrect options: ' + validationError);
        }

        /* End of validation */

        // Adopt the option values from the override
        if (typeof override === 'object') {
            for (let key in override) {
                if (this[key] === undefined) continue;
                this[key] = override[key];
            }
        }

        // Check if specified src directory exists
        if (!fs.existsSync(this.src)) {
            throw new Error(`Given source directory "${this.src}" does not exist.`);
        }

        this.src = path.resolve(this.src);
        this.dist = path.resolve(this.dist);

        // Add git-related ignore entires
        if (this.ignoreGit) this.ignore.push('*.gitignore', '*.git');
        if (this.ignoreDsStore) this.ignore.push('*.DS_Store');

        /* Init minimatch instances for faster matching */

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
        // Deliberately don't support 'all' here

        let relativePath = file.getRelativePath();

        for (let minimatch of this.handledModuleFilesMinimatches) {
            if (minimatch.match(relativePath)) return true;
        }

        return false;
    }
}

// insertPosition is just something like END_OF_HEAD or START_OF_BODY. This method simply splits that up into the element part and the position part.
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

    return { element, position };
}

exports.OptionConstants = OptionConstants;
exports.BundlerOptions = BundlerOptions;
exports.getTargetDataFromInsertPosition = getTargetDataFromInsertPosition;