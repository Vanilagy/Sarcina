const stableSort = require('stable');
const CleanCss = require('clean-css');
const postcss = require('postcss');
const autoprefixer = require('autoprefixer');
const assert = require('assert');

const markup = require('./markup.js');
const util = require('./util.js');
const fileUtils = require('./file_utils.js');
const options = require('./options.js');

async function processStyleElements(markupProcessData) {
    markupProcessData.bundler.log("Processing style elements...");

    if (markupProcessData.bundler.options.bundleCss) await bundleCss(markupProcessData);
    else await labelNecessaryCssFiles(markupProcessData);
}

async function bundleCss(markupProcessData) {
    let cssBundlers = await getCssBundlers(markupProcessData);
    let stringSplicer = new util.StringSplicer(markupProcessData.contents);

    for (let bundler of cssBundlers) {
        let isLocalBundler = bundler.insertPosition === options.OptionConstants.LOCAL;

        // We don't have the following function call, because the elements should already be sorted by index:
        // bundler.sortElementsByIndex();
        // Heck, that's not even a method of CssFileBundler. So yeah, keep this commented out.

        for (let element of bundler.allElements) {
            let start = element.match.index;
            let end = start + element.match[0].length;

            let linebreakBefore = util.getLinebreakBefore(markupProcessData.contents, start);
            let linebreakAfter = util.getLinebreakAfter(markupProcessData.contents, end);

            if (linebreakBefore.empty && linebreakAfter.empty) {
                start = linebreakBefore.newLineIndex;
                end = linebreakAfter.newLineIndex;
            }

            // Aka don't cut the whitespace infront of the first element
            if (isLocalBundler) start = Math.max(start, bundler.allElements[0].match.index);
            
            stringSplicer.addCut(start, end - start);
        }

        if (isLocalBundler) {
            let insertIndex = bundler.allElements[0].match.index; // Beginning of first element
            stringSplicer.addInsert(insertIndex, bundler.finalElements.join(''));
        } else {
            let insertIndex = markupProcessData.getIndexByInsertTargetData(options.getTargetDataFromInsertPosition(bundler.insertPosition));
            stringSplicer.addInsert(insertIndex, bundler.finalElements.join(''));
        }
    }

    let result = stringSplicer.execute();
    markupProcessData.contents = result;

    markupProcessData.updateExclusionRanges();
}

async function labelNecessaryCssFiles(markupProcessData) {
    let linkElements = getCssLinkElements(markupProcessData);

    for (let element of linkElements) {
        let { file } = element;
        if (!file) continue;

        file.isNecessary = true;
    }
}

function getStyleElements(markupProcessData) {
    let styleElements = [];
    
    styleElements.push(...getCssLinkElements(markupProcessData)); // It is important we get cssLinkElements first, because that function could also cut out missingCssFileTags, which would then mess with other indexes if we computed it after something else.
    if (markupProcessData.bundler.options.handleInlineCss) styleElements.push(...getInlineStyleElements(markupProcessData));

    stableSort.inplace(styleElements, (a, b) => a.match.index - b.match.index); // Sort by index

    return styleElements;
}

// Get all <link> elements from the markup
function getCssLinkElements(markupProcessData) {
    let styleElements = [];
    let linkRegExp = /<link(?: (?:.|\s)*?)?>/gi;
    let match;
    let previousIndex;

    while (true) {
        previousIndex = linkRegExp.lastIndex;
        match = linkRegExp.exec(markupProcessData.contents);
        
        if (match === null) break;

        let matchString = match[0];
        if (markupProcessData.isExcludedIndex(match.index)) continue;
        if (!markup.linkElementIsStyleElement(matchString)) continue;

        let url = markup.getHtmlElementAttributeValue(matchString, 'href');
        if (!url) continue;

        let absolute = util.urlIsAbsolute(url);
        let file = null;
        if (!absolute) file = fileUtils.navigateFromDirectoryWithRelativePath(markupProcessData.file.parent, url);

        if (!absolute && !file) {
            // If file doesn't exist
            let action = markupProcessData.bundler.options.missingCssFileTagAction;
            if (action === options.OptionConstants.KEEP) continue; // Skip over this element
            else if (action === options.OptionConstants.REMOVE) {
                // Cut it out
                markupProcessData.contents = util.stringCutout(markupProcessData.contents, match.index, match.index + matchString.length);
                markupProcessData.contents = util.removeLineIfEmpty(markupProcessData.contents, match.index);
                markupProcessData.updateExclusionRanges();

                // Jump back to where the scan began this iteration
                linkRegExp.lastIndex = previousIndex;
            }
        };

        styleElements.push({
            url,
            match,
            file
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

async function getCssBundlers(markupProcessData) {
    let allStyleElements = getStyleElements(markupProcessData);
    let bundlers = [];
    let currentBundler;
    let currentStyleElements = [];

    await addBundler();

    for (let element of allStyleElements) {
        // If insert position is set to LOCAL, see if there is non-empty text inbetween the two elements. If so, add a new bundler, 'cause we need to break here.
        if (markupProcessData.bundler.options.cssInsertPosition === options.OptionConstants.LOCAL) {
            let lastElement = currentStyleElements[currentStyleElements.length - 1];
            if (lastElement) {
                if (!markupProcessData.isEmptyInRange(lastElement.match.index + lastElement.match[0].length, element.match.index)) {
                    await addBundler();
                }
            }
        }

        currentStyleElements.push(element);
    }
    await addBundler();

    async function addBundler() {
        if (currentBundler && currentStyleElements.length) {
            await addStyleElementsToCssBundler(currentStyleElements, currentBundler);
            bundlers.push(currentBundler);
        }

        currentBundler = new CssFileBundler(markupProcessData);
        currentStyleElements.length = 0;
    }

    return bundlers;
}

async function addStyleElementsToCssBundler(styleElements, cssBundler) {
    for (let element of styleElements) {
        let { url, body, file } = element;

        if (url) {
            if (util.urlIsAbsolute(url)) { // If non-local stylesheet
                await cssBundler.addCurrentBundle();

                let attributes = {
                    rel: 'stylesheet',
                    href: url
                };
                let elementStr = createLinkElement(attributes);
                cssBundler.finalElements.push(elementStr);
            } else { // Otherwise
                assert(file);
        
                let contents = file.getRawContents();
                cssBundler.add(contents, file, element);
            }
        } else if (body) {
            cssBundler.add(body, null, element);
        }
        
    }
    await cssBundler.addCurrentBundle();
}

class CssFileBundler {
    constructor(markupProcessData) {
        this.markupProcessData = markupProcessData;
        this.insertPosition = markupProcessData.bundler.options.cssInsertPosition;
        this.allElements = [];
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
        if (file !== null) {
            this.currentBundleFiles.push(file);
        }
        if (element !== null) {
            this.allElements.push(element);
            this.currentBundleElements.push(element);
        }
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

            let elementStr = createStyleElement({}, code);
            this.finalElements.push(elementStr);
        } else {
            let pathString = fileUtils.getPathFromFileAToFileB(this.markupProcessData.file, bundle.file);

            let attributes = {
                rel: 'stylesheet',
                href: pathString
            };
            let elementStr = createLinkElement(attributes);
            this.finalElements.push(elementStr);
        }

        this.currentBundleCode = '';
        this.currentBundleFiles.length = 0;
        this.currentBundleElements.length = 0;
    }
}

function createLinkElement(attributes = {}) {
    let elementStr = `<link`;

    for (let attributeName in attributes) {
        let value = attributes[attributeName];

        elementStr += ` ${attributeName}`;
        if (typeof value === 'string') elementStr += `="${value}"`;
        else if (typeof value === 'boolean') elementStr += `="${value}"`;
    }

    elementStr += '>';

    return elementStr;
}

function createStyleElement(attributes = {}, body) {
    let elementStr = `<style`;

    for (let attributeName in attributes) {
        let value = attributes[attributeName];

        elementStr += ` ${attributeName}`;
        if (typeof value === 'string') elementStr += `="${value}"`;
        else if (typeof value === 'boolean') elementStr += `="${value}"`;
    }

    elementStr += '>';
    if (body) elementStr += body;
    elementStr += '</style>';

    return elementStr;   
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

// Replace '</style' with '\u003c/style' (so that it doesn't exit the <style> element)
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

async function handleCssFile(file, bundler) {
    bundler.log(`Handling CSS file "${file.getRelativePath()}"...`)

    let code = file.getRawContents();
    code = await processCss(code, bundler);

    file.contentOverride = code;
    file.isNecessary = true;
}

exports.processStyleElements = processStyleElements;
exports.handleCssFile = handleCssFile;