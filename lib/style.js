const markup = require('./markup.js');
const util = require('./util.js');
const fileUtils = require('./file_utils.js');
const bundler = require('./bundler.js');

function processStyleElements(obj) {
    obj.bundler.log("Processing style elements...");

    let linkRegExp = /<link (.|\n)*?>/gi;
    let match;
    let currentBundleCode = '';
    let currentBundleFiles = [];
    let finalElements = [];

    while ((match = linkRegExp.exec(obj.contents)) !== null) {
        let matchString = match[0];
        if (obj.isExcludedIndex(match.index)) continue;
        if (!markup.linkElementIsStyleElement(matchString)) continue;

        let url = markup.getHtmlElementAttributeValue(matchString, 'href');
        if (!url) continue; // Error here?

        if (util.urlIsAbsolute(url)) {
            addCurrentBundle();

            finalElements.push(`<link rel="stylesheet" href="${url}">`);
        } else {
            let file = fileUtils.navigateFromDirectoryWithRelativePath(obj.file.parent, url);
            if (!file) continue; // Just IGNORE the statement if it points to no file. Maybe throw?

            let contents = file.getContents();

            if (currentBundleFiles.length > 0) currentBundleCode += '\n\n';
            currentBundleCode += contents;
            currentBundleFiles.push(file);
        }

        obj.contents = util.stringCutout(obj.contents, match.index, match.index + matchString.length);
        obj.contents = util.removeWhitespaceLine(obj.contents, match.index);
        obj.updateExclusionRanges;

        linkRegExp.lastIndex -= matchString.length;
    }
    addCurrentBundle();
    
    function addCurrentBundle() {
        if (currentBundleFiles.length === 0) return;

        let code;
        if (obj.bundler.options.minifyCss) {
            obj.bundler.log("Processing CSS...");
            code = minifyCss(currentBundleCode);
        } else {
            code = currentBundleCode;
        }

        let bundle;
        if (obj.bundler.options.injectCss) {
            bundle = bundler.EMPTY_BUNDLE;

            finalElements.push(`<style>${code}</style>`);
        } else {
            bundle = obj.bundler.createBundle('.css', currentBundleFiles, code);
            let pathString = fileUtils.getPathFromFileAToFileB(obj.file, bundle.file);

            finalElements.push(`<link rel="stylesheet" href="${pathString}">`);
        }

        for (let file of currentBundleFiles) {
            file.bundles.add(bundle);
        }

        currentBundleCode = '';
        currentBundleFiles.length = 0;
    }

    let insertString = '';
    for (let element of finalElements) {
        insertString += element;
    }

    let closingHeadTagIndex = obj.contents.search(/<\/head>/i);
    obj.contents = util.stringInsertAt(obj.contents, closingHeadTagIndex, insertString);

    obj.updateExclusionRanges();
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