const markup = require('./markup.js');
const util = require('./util.js');
const fileUtils = require('./file_utils.js');
const stableSort = require('stable');
const postcss = require('postcss');
const autoprefixer = require('autoprefixer');

async function processStyleElements(obj) {
    obj.bundler.log("Processing style elements...");

    let styleElements = [];
    styleElements.push(...getCssLinkElements(obj));
    if (obj.bundler.options.handleInlineCss) styleElements.push(...getInlineStyleElements(obj));
    stableSort.inplace(styleElements, (a, b) => a.match.index - b.match.index);
    cutElements(styleElements, obj);

    let cssBundler = new CssFileBundler(obj);
    await addStyleElementsToCssBuilder(styleElements, cssBundler, obj);

    let insertString = '';
    for (let element of cssBundler.finalElements) {
        insertString += element;
    }

    let closingHeadTagIndex = obj.contents.search(/<\/head>/i);
    obj.contents = util.stringInsertAt(obj.contents, closingHeadTagIndex, insertString);

    obj.updateExclusionRanges();
}

function getCssLinkElements(obj) {
    let styleElements = [];
    let linkRegExp = /<link(?: (?:.|\s)*?)?>/gi;
    let match;

    while ((match = linkRegExp.exec(obj.contents)) !== null) {
        let matchString = match[0];
        if (obj.isExcludedIndex(match.index)) continue;
        if (!markup.linkElementIsStyleElement(matchString)) continue;

        let url = markup.getHtmlElementAttributeValue(matchString, 'href');
        if (!url) continue; // Error here?

        styleElements.push({
            url,
            match
        });
    }

    return styleElements;
}

function getInlineStyleElements(obj) {
    let styleElements = [];
    let styleRegExp = /<style(?: (?:.|\s)*?)?>((?:.|\s)*?)<\/style(?: (?:.|\s)*?)?>/gi;
    let match;

    while ((match = styleRegExp.exec(obj.contents)) !== null) {
        if (obj.isExcludedIndex(match.index)) continue;

        let body = match[1];
        if (!body) continue;

        styleElements.push({
            body,
            match
        });
    }

    return styleElements;
}

function cutElements(styleElements, obj) {
    for (let i = styleElements.length-1; i >= 0; i--) {
        let element = styleElements[i];
        let match = element.match;

        obj.contents = util.stringCutout(obj.contents, match.index, match.index + match[0].length);
        obj.contents = util.removeWhitespaceLine(obj.contents, match.index);
    }

    obj.updateExclusionRanges();
}

async function addStyleElementsToCssBuilder(styleElements, cssBuilder, obj) {
    for (let element of styleElements) {
        let { url, body } = element;

        if (url) {
            if (util.urlIsAbsolute(url)) {
                await cssBuilder.addCurrentBundle();
        
                cssBuilder.finalElements.push(createStyleElement(url));
            } else {
                let file = fileUtils.navigateFromDirectoryWithRelativePath(obj.file.parent, url);
                if (!file) continue; // Just IGNORE the statement if it points to no file. Maybe throw?
        
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
    constructor(markupProcessObject) {
        this.markupProcessObject = markupProcessObject;
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

    async addCurrentBundle() {
        if (this.currentBundleElements.length === 0) return;

        let bundle = this.markupProcessObject.bundler.getBundleWithMatchingFiles(this.currentBundleFiles);
        let code;

        if (bundle) {
            code = bundle.getCode();
        } else {
            code = await processCss(this.currentBundleCode, this.markupProcessObject.bundler);

            if (this.markupProcessObject.bundler.options.injectCss) {
                bundle = this.markupProcessObject.bundler.createBundle('.css', this.currentBundleFiles, code, true);
            } else {
                bundle = this.markupProcessObject.bundler.createBundle('.css', this.currentBundleFiles, code);
            }

            for (let file of this.currentBundleFiles) {
                file.bundles.add(bundle);
            }
        }

        if (this.markupProcessObject.bundler.options.injectCss) {
            if (this.markupProcessObject.bundler.options.sanitizeInjectedCss) code = sanitizeCss(code, this.markupProcessObject.bundler);

            let elementStr = createStyleElement(null, code);
            this.finalElements.push(elementStr);
        } else {
            let pathString = fileUtils.getPathFromFileAToFileB(this.markupProcessObject.file, bundle.file);
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

    if (bundler.options.minifyCss) code = minifyCss(code);
    if (bundler.options.autoprefixCss) code = await autoprefixCss(code);

    return code;
}

function autoprefixCss(code) {
    return new Promise((resolve, reject) => {
        postcss([autoprefixer()]).process(code, {from: undefined}).then((result) => { 
            result.warnings().forEach((warn) => {
                console.warn('CSS autoprefixer warning: ' + warn.toString());
            });

            resolve(result.css);
        });
    });
}

function minifyCss(str) {
    let commentRegExp = /\/\*(.|\s)*?\*\//;
    let match;
    while ((match = commentRegExp.exec(str)) !== null) {
        str = str.slice(0, match.index) + str.slice(match.index + match[0].length);
        commentRegExp.lastIndex -= match[0].length;
    }
    
    let index = 0;
    while (index < str.length) {
        let char = str[index];
        
        if (char === '{') {
            let index2 = index-1;
            while (util.isWhitespace(str[index2])) {
                index2--;
            }
            str = str.slice(0, index2+1) + str.slice(index);
            index -= (index-index2-1);
        }
        if (char === '{' || char === '}' || char === ':' || char === ';' || char === ',') {
            let index2 = index+1;
            while (util.isWhitespace(str[index2])) {
                index2++;
            }
            str = str.slice(0, index+1) + str.slice(index2);
        }
        if (char === '\n' || char === '\r') {
            str = str.slice(0, index) + str.slice(index+1);
            index--;
        }
        
        index++;
    }
    
    return str.trim();
}

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