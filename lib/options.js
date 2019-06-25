const path = require('path');
const minimatch = require('minimatch');

const OptionConstants = {
    REMOVE_ALL: 0,
    REMOVE_BUNDLED: 1,
    KEEP_ALL: 2
};
const DEFAULT_OPTIONS = {
    src: path.resolve('./src'),
    dist: path.resolve('./dist'),
    verbose: true,

    bundleScripts: true,
    minifyScript: true,
    iifeScript: true,
    handleInlineScripts: true,
    bundleCss: true,
    minifyCss: true,
    handleInlineCss: true,
    minifyHtml: true,

    removeEmptyDirectories: true,
    scriptFileAction: OptionConstants.REMOVE_BUNDLED,
    cssFileAction: OptionConstants.REMOVE_BUNDLED,
    keep: [],
    ignore: [],
    ignoreGit: true,
    ignoreDsStore: true,
    
    randomBundleNames: true,
    injectScript: false,
    injectCss: false
};

class Options {
    constructor(override) {
        for (let key in DEFAULT_OPTIONS) {
            this[key] = DEFAULT_OPTIONS[key];
        }

        if (typeof override === 'object') {
            for (let key in override) {
                if (this[key] === undefined) continue;
                this[key] = override[key];
            }
        }
    }

    pathIsIgnored(relativePath) {
        for (let pattern of this.ignore) {
            if (minimatch(relativePath, pattern, {matchBase: true, dot: true})) return true;
        }
    
        return false;
    }

    pathShouldBeKept(relativePath) {
        for (let pattern of this.keep) {
            if (minimatch(relativePath, pattern, {matchBase: true, dot: true})) return true;
        }
    
        return false;
    }
}

exports.OptionConstants = OptionConstants;
exports.Options = Options;