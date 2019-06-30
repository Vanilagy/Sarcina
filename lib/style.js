const markup = require('./markup.js');
const util = require('./util.js');
const fileUtils = require('./file_utils.js');
const stableSort = require('stable');
const CleanCss = require('clean-css');
const postcss = require('postcss');
const autoprefixer = require('autoprefixer');

const options = require('./options.js');

async function processStyleElements(markupProcessData) {
    markupProcessData.bundler.log("Processing style elements...");

    let styleElements = [];
    styleElements.push(...getCssLinkElements(markupProcessData));
    if (markupProcessData.bundler.options.handleInlineCss) styleElements.push(...getInlineStyleElements(markupProcessData));
    stableSort.inplace(styleElements, (a, b) => a.match.index - b.match.index); // Sort by index
    cutElements(styleElements, markupProcessData);

    let cssBundler = new CssFileBundler(markupProcessData);
    await addStyleElementsToCssBuilder(styleElements, cssBundler);

    let insertString = '';
    for (let element of cssBundler.finalElements) {
        insertString += element;
    }

    let closingHeadTagIndex = markupProcessData.contents.search(/<\/head>/i);
    markupProcessData.contents = util.stringInsertAt(markupProcessData.contents, closingHeadTagIndex, insertString);

    markupProcessData.updateExclusionRanges();
}

// Get all <link> elements from the markup
function getCssLinkElements(markupProcessData) {
    let styleElements = [];
    let linkRegExp = /<link(?: (?:.|\s)*?)?>/gi;
    let match;

    while ((match = linkRegExp.exec(markupProcessData.contents)) !== null) {
        let matchString = match[0];
        if (markupProcessData.isExcludedIndex(match.index)) continue;
        if (!markup.linkElementIsStyleElement(matchString)) continue;

        let url = markup.getHtmlElementAttributeValue(matchString, 'href');
        if (!url) continue;

        if (!util.urlIsAbsolute(url) && !fileUtils.navigateFromDirectoryWithRelativePath(markupProcessData.file.parent, url)) {
            // If file doesn't exist
            if (markupProcessData.bundler.options.missingCssFileTagAction === options.OptionConstants.KEEP) continue;
        };

        styleElements.push({
            url,
            match
        });
    }

    return styleElements;
}

// Get all <style> elements from the markup
function getInlineStyleElements(markupProcessData) {
    let styleElements = [];
    let styleRegExp = /<style(?: (?:.|\s)*?)?>((?:.|\s)*?)<\/style(?: (?:.|\s)*?)?>/gi;
    let match;

    while ((match = styleRegExp.exec(markupProcessData.contents)) !== null) {
        if (markupProcessData.isExcludedIndex(match.index)) continue;

        let body = match[1];
        if (!body) continue;

        styleElements.push({
            body,
            match
        });
    }

    return styleElements;
}

// Cut out <link> and <style> elements from the markup
function cutElements(styleElements, markupProcessData) {
    for (let i = styleElements.length-1; i >= 0; i--) {
        let element = styleElements[i];
        let match = element.match;

        markupProcessData.contents = util.stringCutout(markupProcessData.contents, match.index, match.index + match[0].length);
        markupProcessData.contents = util.removeWhitespaceLine(markupProcessData.contents, match.index);
    }

    markupProcessData.updateExclusionRanges();
}

async function addStyleElementsToCssBuilder(styleElements, cssBuilder) {
    for (let element of styleElements) {
        let { url, body } = element;

        if (url) {
            if (util.urlIsAbsolute(url)) { // If non-local stylesheet
                await cssBuilder.addCurrentBundle();
        
                cssBuilder.finalElements.push(createStyleElement(url));
            } else { // Otherwise
                let file = fileUtils.navigateFromDirectoryWithRelativePath(cssBuilder.markupProcessData.file.parent, url);
                if (!file) continue;
        
                let contents = file.getContents();
                cssBuilder.add(contents, file, element);
            }
        } else if (body) {
            cssBuilder.add(body, null, element);
        }
        
    }
    await cssBuilder.addCurrentBundle();
}

class CssFileBundler {
    constructor(markupProcessData) {
        this.markupProcessData = markupProcessData;
        this.currentBundleCode = '';
        this.currentBundleFiles = [];
        this.currentBundleElements = [];
        this.finalElements = [];
    }

    add(code = null, file = null, element = null) {
        if (code !== null) {
            if (this.currentBundleCode.length > 0) this.currentBundleCode += '\n\n';
            this.currentBundleCode += code;
        }
        if (file !== null) this.currentBundleFiles.push(file);
        if (element !== null) this.currentBundleElements.push(element);
    }

    // Create a bundle from the current elements
    async addCurrentBundle() {
        if (this.currentBundleElements.length === 0) return;

        // Get existing bundle if possible
        let bundle = this.markupProcessData.bundler.getBundleWithMatchingFiles(this.currentBundleFiles);
        let code;

        if (bundle) {
            code = bundle.getCode();
        } else { // Create new bundle
            code = await processCss(this.currentBundleCode, this.markupProcessData.bundler);

            if (this.markupProcessData.bundler.options.injectCss) {
                // Create a virtual bundle
                bundle = this.markupProcessData.bundler.createBundle('.css', this.currentBundleFiles, code, true);
            } else {
                // Create a non-virtual bundle
                bundle = this.markupProcessData.bundler.createBundle('.css', this.currentBundleFiles, code);
            }

            for (let file of this.currentBundleFiles) {
                file.bundles.add(bundle);
            }
        }

        if (this.markupProcessData.bundler.options.injectCss) {
            // Sanitize CSS for injection
            if (this.markupProcessData.bundler.options.sanitizeInjectedCss) code = sanitizeCss(code, this.markupProcessData.bundler);

            let elementStr = createStyleElement(null, code);
            this.finalElements.push(elementStr);
        } else {
            let pathString = fileUtils.getPathFromFileAToFileB(this.markupProcessData.file, bundle.file);
            let elementStr = createStyleElement(pathString);
            this.finalElements.push(elementStr);
        }

        this.currentBundleCode = '';
        this.currentBundleFiles.length = 0;
        this.currentBundleElements.length = 0;
    }
}

function createStyleElement(url, body) {
    if (body !== undefined) {
        return `<style>${body}</style>`;
    }

    return `<link rel="stylesheet" href="${url}">`;
}

async function processCss(code, bundler) {
    bundler.log("Processing CSS...");

    // Add vendor prefixes
    if (bundler.options.autoprefixCss) code = await autoprefixCss(code);
    
    // Minify / optimize
    if (bundler.options.minifyCss || bundler.options.optimizeCss) {
        let options = {};

        if (!bundler.options.minifyCss) options.format = 'beautify'; // Meaning: "Don't minify"
        if (bundler.options.optimizeCss) options.level = { // Meaning: All default optimization options
            2: {}
        };

        let result = new CleanCss(options).minify(code);
        if (result.errors.length) {
            result.errors.forEach((a) => console.error(a));
            throw new Error("Error processing CSS");
        }

        code = result.styles;
    }

    return code;
}

function autoprefixCss(code) {
    return new Promise((resolve, reject) => {
        postcss([autoprefixer()]).process(code, {from: undefined}).then((result) => { 
            result.warnings().forEach((warn) => {
                console.warn('CSS autoprefixer warning: ' + warn.toString());
            });

            resolve(result.css);
        }).catch((e) => reject(e));
    });
}

// Replace '</style' with '\u003c/style' (so that doesn't exit the <style> element)
function sanitizeCss(code, bundler) {
    bundler.log("Sanitizing CSS for injection...");

    let styleEndTagRegEx = /<\/style/gi;
    let match;

    while ((match = styleEndTagRegEx.exec(code)) !== null) {
        let index = match.index;

        code = code.slice(0, index) + util.LESS_THAN_SIGN_UNICODE + code.slice(index + 1);
    }

    return code;
}

exports.processStyleElements = processStyleElements;