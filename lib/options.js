const path = require('path');
const minimatch = require('minimatch');
const fs = require('fs-extra');

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
    src: path.resolve('./src'),
    dist: path.resolve('./dist'),
    verbose: false,
    randomBundleNames: true,

    bundleCss: true,
    minifyCss: true,
    optimizeCss: false,
    autoprefixCss: false,
    handleInlineCss: true,
    injectCss: false,
    sanitizeInjectedCss: true,
    cssFileAction: OptionConstants.REMOVE_BUNDLED,
    missingCssFileTagAction: OptionConstants.KEEP,

    bundleScripts: true,
    minifyScript: true,
    transpileScript: false,
    iifeScript: false,
    handleInlineScripts: true,
    injectScript: false,
    sanitizeInjectedScript: true,
    scriptFileAction: OptionConstants.REMOVE_BUNDLED,
    missingScriptFileTagAction: OptionConstants.KEEP,
    uglifyOptionsOverride: null,

    minifyHtml: true,

    removeEmptyDirectories: true,
    keep: [],
    ignore: [],
    ignoreGit: true,
    ignoreDsStore: true,
};
const MINIMATCH_OPTIONS = {matchBase: true, dot: true};

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

        this.keepMinimatches = [];
        this.ignoreMinimatches = [];

        for (let pattern of this.keep) {
            this.keepMinimatches.push(new minimatch.Minimatch(pattern, MINIMATCH_OPTIONS));
        }
        for (let pattern of this.ignore) {
            this.ignoreMinimatches.push(new minimatch.Minimatch(pattern, MINIMATCH_OPTIONS));
        }
    }

    pathShouldBeKept(relativePath) {
        for (let minimatch of this.keepMinimatches) {
            if (minimatch.match(relativePath)) return true;
        }
    
        return false;
    }

    pathIsIgnored(relativePath) {
        for (let minimatch of this.ignoreMinimatches) {
            if (minimatch.match(relativePath)) return true;
        }
    
        return false;
    }
}

exports.OptionConstants = OptionConstants;
exports.BundlerOptions = BundlerOptions;