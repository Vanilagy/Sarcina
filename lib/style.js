const markup = require('./markup.js');
const util = require('./util.js');
const fileUtils = require('./file_utils.js');
const bundler = require('./bundler.js');

function processStyleElements(obj) {
    obj.bundler.log("Processing style elements...");

    let styleElements = cutStyleElements(obj);

    let cssBundler = new CssFileBundler(obj);
    addStyleElementsToCssBuilder(styleElements, cssBundler, obj);

    let insertString = '';
    for (let element of cssBundler.finalElements) {
        insertString += element;
    }

    let closingHeadTagIndex = obj.contents.search(/<\/head>/i);
    obj.contents = util.stringInsertAt(obj.contents, closingHeadTagIndex, insertString);

    obj.updateExclusionRanges();
}

function cutStyleElements(obj) {
    let styleElements = [];
    let linkRegExp = /<link (.|\n)*?>/gi;
    let match;

    while ((match = linkRegExp.exec(obj.contents)) !== null) {
        let matchString = match[0];
        if (obj.isExcludedIndex(match.index)) continue;
        if (!markup.linkElementIsStyleElement(matchString)) continue;

        let url = markup.getHtmlElementAttributeValue(matchString, 'href');
        if (!url) continue; // Error here?

        styleElements.push({
            url
        });

        obj.contents = util.stringCutout(obj.contents, match.index, match.index + matchString.length);
        obj.contents = util.removeWhitespaceLine(obj.contents, match.index);
        obj.updateExclusionRanges;

        linkRegExp.lastIndex -= matchString.length;
    }

    return styleElements;
}

function addStyleElementsToCssBuilder(styleElements, cssBuilder, obj) {
    for (let element of styleElements) {
        let url = element.url;

        if (util.urlIsAbsolute(url)) {
            cssBuilder.addCurrentBundle();
    
            cssBuilder.finalElements.push(createStyleElement(url));
        } else {
            let file = fileUtils.navigateFromDirectoryWithRelativePath(obj.file.parent, url);
            if (!file) continue; // Just IGNORE the statement if it points to no file. Maybe throw?
    
            let contents = file.getContents();
            cssBuilder.add(contents, file);
        }
    }
    cssBuilder.addCurrentBundle();
}


class CssFileBundler {
    constructor(markupProcessObject) {
        this.markupProcessObject = markupProcessObject;
        this.currentBundleCode = '';
        this.currentBundleFiles = [];
        this.finalElements = [];
    }

    add(code = null, file = null) {
        if (code !== null) {
            if (this.currentBundleCode.length > 0) this.currentBundleCode += '\n\n';
            this.currentBundleCode += code;
        }
        if (file !== null) this.currentBundleFiles.push(file);
    }

    addCurrentBundle() {
        if (this.currentBundleFiles.length === 0) return;

        let code = processCss(this.currentBundleCode, this.markupProcessObject.bundler);

        let bundle;
        if (this.markupProcessObject.bundler.options.injectCss) {
            bundle = bundler.EMPTY_BUNDLE;

            this.finalElements.push(createStyleElement(null, code));
        } else {
            bundle = this.markupProcessObject.bundler.createBundle('.css', this.currentBundleFiles, code);
            let pathString = fileUtils.getPathFromFileAToFileB(this.markupProcessObject.file, bundle.file);

            this.finalElements.push(createStyleElement(pathString));
        }

        for (let file of this.currentBundleFiles) {
            file.bundles.add(bundle);
        }

        this.currentBundleCode = '';
        this.currentBundleFiles.length = 0;
    }
}

function createStyleElement(url, body) {
    if (body !== undefined) {
        return `<style>${body}</style>`;
    }

    return `<link rel="stylesheet" href="${url}">`;
}

function processCss(code, bundler) {
    bundler.log("Processing CSS...");

    if (bundler.options.minifyCss) code = minifyCss(code);

    return code;
}

function minifyCss(str) {
    let commentRegExp = /\/\*(.|\n)*?\*\//;
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
    
    return str;
}

exports.processStyleElements = processStyleElements;