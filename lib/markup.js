const htmlMinify = require('html-minifier').minify;

const fileUtils = require('./file_utils.js');
const style = require('./style.js');
const scripts = require('./scripts.js');

const MARKUP_EXTENSIONS = ['.html', '.htm', '.php'];

async function processMarkup(file, bundler) {
    bundler.log(`Processing "${file.getRelativePath()}"...`);
    
    let markupProcessObject = new MarkupProcessData(file, bundler);

    if (bundler.options.bundleScripts) style.processStyleElements(markupProcessObject);
    if (bundler.options.bundleCss) await scripts.processScriptElements(markupProcessObject);
    if (bundler.options.minifyHtml) minifyMarkup(markupProcessObject);

    file.contentOverride = markupProcessObject.contents;
}

class MarkupProcessData {
    constructor(file, bundler) {
        this.file = file;
        this.contents = this.file.getContents();
        this.bundler = bundler;
        this.exclusionRanges = [];

        this.updateExclusionRanges();
    }

    isExcludedIndex(index) {
        for (let exclusionRange of this.exclusionRanges) {
            if (index >= exclusionRange.start && index < exclusionRange.end) return true;
        }

        return false;
    }

    updateExclusionRanges() {
        this.exclusionRanges.length = 0;

        if (fileUtils.isPHPFile(this.file)) this.excludePhpBlocks();
        this.excludeHtmlComments();
    }

    excludePhpBlocks() {
        let phpStartRegEx = /(<\?php|<\?=)/gi;
        let phpEndRegEx = /\?>/g;
        let match;
    
        while ((match = phpStartRegEx.exec(this.contents)) !== null) {
            let start = match.index;
            let end;
    
            if (this.isExcludedIndex(start)) continue;
    
            phpEndRegEx.lastIndex = start;
            let endMatch = phpEndRegEx.exec(this.contents);
    
            if (endMatch) {
                end = endMatch.index + endMatch[0].length;
            } else {
                end = this.contents.length;
            }
    
            this.exclusionRanges.push({start, end});
        }
    }

    excludeHtmlComments() {
        let htmlCommentStartRegEx = /<!--/g;
        let htmlCommentEndRegEx = /-->/g;
        let match;
    
        while ((match = htmlCommentStartRegEx.exec(this.contents)) !== null) {
            let start = match.index;
            let end;
    
            if (this.isExcludedIndex(start)) continue;
    
            htmlCommentEndRegEx.lastIndex = start;
            let endMatch = htmlCommentEndRegEx.exec(this.contents);
    
            if (endMatch) {
                end = endMatch.index + endMatch[0].length;
            } else {
                end = this.contents.length;
            }
    
            this.exclusionRanges.push({start, end});
        }
    }
}

function minifyMarkup(obj) {
    log(`Minifying "${obj.file.getRelativePath()}"...`);

    obj.contents = htmlMinify(obj.contents, {
        collapseWhitespace: true,
        conservativeCollapse: true,
        removeComments: true
    });
}

function htmlElementAttributeIsSet(elementStr, attributeName) {
    return elementStr.includes(' ' + attributeName);
}

function getHtmlElementAttributeValue(elementStr, attributeName) {
    let regExp = new RegExp(` ${attributeName}=".+?"`); // Double ticks " "
    let match = regExp.exec(elementStr);

    if (match === null) {
        regExp = new RegExp(` ${attributeName}='.+?'`); // Single ticks ' '
        match = regExp.exec(elementStr);
    }

    if (match) return match[0].slice(attributeName.length + 3, -1);
    return null;
}

function linkElementIsStyleElement(linkElementStr) {
    return linkElementStr.includes(`rel="stylesheet"`) || linkElementStr.includes(`rel=\'stylesheet\'`);
}

exports.MARKUP_EXTENSIONS = MARKUP_EXTENSIONS;
exports.processMarkup = processMarkup;
exports.linkElementIsStyleElement = linkElementIsStyleElement;
exports.htmlElementAttributeIsSet = htmlElementAttributeIsSet;
exports.getHtmlElementAttributeValue = getHtmlElementAttributeValue;