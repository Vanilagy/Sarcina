const htmlMinify = require('html-minifier').minify;

const fileUtils = require('./file_utils.js');
const style = require('./style.js');
const scripts = require('./scripts.js');
const util = require('./util.js');

const MARKUP_EXTENSIONS = ['.html', '.htm', '.php'];

async function processMarkup(file, bundler) {
    bundler.log(`Processing "${file.getRelativePath()}"...`);
    
    let markupProcessData = new MarkupProcessData(file, bundler);

    // This has to be done to unify line removal
    markupProcessData.contents = util.replaceCRLFwithLF(markupProcessData.contents);
    markupProcessData.updateExclusionRanges();

    await style.processStyleElements(markupProcessData);
    await scripts.processScriptElements(markupProcessData);
    if (bundler.options.minifyHtml) minifyMarkup(markupProcessData);

    file.contentOverride = markupProcessData.contents;
}

// Stores data about the current markup being processed
class MarkupProcessData {
    constructor(file, bundler) {
        this.file = file;
        this.contents = this.file.getRawContents();
        this.bundler = bundler;
        this.exclusionRanges = []; // Exclusion range: Index ranges to be ignored because they are commented out / are PHP blocks
    }

    // Returns whether or not an index lies inside an excluded range
    isExcludedIndex(index) {
        for (let exclusionRange of this.exclusionRanges) {
            if (index >= exclusionRange.start && index < exclusionRange.end) return true;
        }

        return false;
    }

    // For debug:
    logExcludedRanges() {
        for (let exclusionRange of this.exclusionRanges) {
            console.log(this.contents.slice(exclusionRange.start, exclusionRange.end));
        }
    }

    updateExclusionRanges() {
        this.exclusionRanges.length = 0;

        if (fileUtils.isPHPFile(this.file)) this.excludePhpBlocks();
        this.excludeHtmlComments();
    }

    // Adds exclusion ranges based on PHP blocks
    excludePhpBlocks() {
        let phpBlockStartRegEx = /(<\?php|<\?=)/gi;
        let phpBlockEndRegEx = /\?>/g;
        let match;
    
        while ((match = phpBlockStartRegEx.exec(this.contents)) !== null) {
            let start = match.index;
            let end;
    
            if (this.isExcludedIndex(start)) continue;
    
            phpBlockEndRegEx.lastIndex = start + match[0].length;
            let endMatch = phpBlockEndRegEx.exec(this.contents);
    
            if (endMatch) {
                end = endMatch.index + endMatch[0].length;
            } else {
                // If the tag is not closed, it continues to the end of the file
                end = this.contents.length;
            }
            phpBlockStartRegEx.lastIndex = end;
    
            this.exclusionRanges.push({start, end});
        }
    }

    // Adds exclusion ranges based on HTML comments
    excludeHtmlComments() {
        let htmlCommentStartRegEx = /<!--/g;
        let htmlCommentEndRegEx = /-->/g;
        let match;
    
        while ((match = htmlCommentStartRegEx.exec(this.contents)) !== null) {
            let start = match.index;
            let end;
    
            if (this.isExcludedIndex(start)) continue;
    
            htmlCommentEndRegEx.lastIndex = start + match[0].length;
            let endMatch = htmlCommentEndRegEx.exec(this.contents);
    
            if (endMatch) {
                end = endMatch.index + endMatch[0].length;
            } else {
                // If the comment is not closed, it continues to the end of the file
                end = this.contents.length;
            }
            htmlCommentStartRegEx.lastIndex = end;
    
            this.exclusionRanges.push({start, end});
        }
    }

    isEmptyInRange(start, end) { // Text in range is only whitespace or comments
        for (let index = start; index < end; index++) {
            let char = this.contents.charAt(index);
            if (!util.isWhitespace(char) && !this.isExcludedIndex(index)) return false;
        }

        return true;
    }

    getIndexByInsertTargetData(targetData) {
        let tagName;
        switch (targetData.element) {
            case 'head': tagName = 'head'; break;
            case 'body': tagName = 'body'; break;
            case 'document': tagName = 'html'; break;
            case 'file' : {
                if (targetData.position === 'start') return 0;
                else return this.contents.length;
            };
        }

        let regExp = new RegExp('<' + ((targetData.position === 'start')? '' : '/') + tagName + '(?: (?:.|\s)*?)?>', 'gi');
        let index, match;

        while ((match = regExp.exec(this.contents)) !== null) {
            if (!this.isExcludedIndex(match.index)) {
                index = match.index;
                break;
            }
        }

        if (index === undefined) {
            let nextElement;
            if (tagName === 'head' || tagName === 'body') nextElement = 'document';
            else if (tagName === 'html') nextElement = 'file';

            this.bundler.log('WARNING: ' + targetData.position + ' of ' + targetData.element + ' was not found. Trying to insert at ' + targetData.position + ' of ' + nextElement + ' instead.', true);
            return this.getIndexByInsertTargetData({element: nextElement, position: targetData.position});
        }

        if (targetData.position === 'start') index += match[0].length;
        return index;
    }
}

function minifyMarkup(markupProcessData) {
    markupProcessData.bundler.log(`Minifying "${markupProcessData.file.getRelativePath()}"...`);

    markupProcessData.contents = htmlMinify(markupProcessData.contents, {
        collapseWhitespace: true,
        conservativeCollapse: true,
        removeComments: true
    });
}

// Returns whether or not an HTML element has a certain attribute set. Like, <img src="..."> has the 'src' attribute set.
function htmlElementAttributeIsSet(elementStr, attributeName) {
    return elementStr.toLowerCase().includes(' ' + attributeName);
}

// Returns the value of an HTML element's attribute. The value of 'src' in <img src="url"> is 'url'.
function getHtmlElementAttributeValue(elementStr, attributeName) {
    let regExp = new RegExp(` ${attributeName}=".+?"`, 'i'); // Double ticks " "
    let match = regExp.exec(elementStr);

    if (match === null) {
        regExp = new RegExp(` ${attributeName}='.+?'`, 'i'); // Single ticks ' '
        match = regExp.exec(elementStr);
    }

    if (match) return match[0].slice(attributeName.length + 3, -1);
    return null;
}

// Returns whether or not a <link> element is rel="stylesheet"
function linkElementIsStyleElement(linkElementStr) {
    return getHtmlElementAttributeValue(linkElementStr, 'rel') === 'stylesheet';
}

exports.MARKUP_EXTENSIONS = MARKUP_EXTENSIONS;
exports.processMarkup = processMarkup;
exports.linkElementIsStyleElement = linkElementIsStyleElement;
exports.htmlElementAttributeIsSet = htmlElementAttributeIsSet;
exports.getHtmlElementAttributeValue = getHtmlElementAttributeValue;