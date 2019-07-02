const stableSort = require('stable');

const LESS_THAN_SIGN_UNICODE = '\\u003c';

function cloneObject(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function stringCutout(str, start, end) {
    return str.slice(0, start) + str.slice(end);
}

function isWhitespace(char) {
    return char === ' ' || char === '\n' || char === '\t' || char === '\r';
}

function removeLineIfEmpty(str, index) { // "empty" === whitespace-only
    // If 'index' is inside a whitespace-only line, remove that line and return the edited string. Otherwise, return the original string.

    let linebreakBefore = getLinebreakBefore(str, index);
    let linebreakAfter = getLinebreakAfter(str, index);

    if (!linebreakBefore.empty || !linebreakAfter.empty) return str;

    return stringCutout(str, linebreakBefore.newLineIndex, linebreakAfter.newLineIndex);
}

function indexIsInsideEmptyLine(str, index) { // "empty" === whitespace-only
    return getLinebreakBefore(str, index).empty && getLinebreakAfter(str, index).empty;
}

function getLinebreakBefore(str, startingIndex) {
    let index;
    let empty = true; // If, inbetween the linebreak and the starting index, there is nothing but whitespace

    for (index = startingIndex - 1; index >= 0; index--) {
        let char = str.charAt(index);

        if (!isWhitespace(char)) empty = false;
        if (char === '\n') break;
    }

    return { empty, newLineIndex: index };
}

function getLinebreakAfter(str, startingIndex) {
    let index;
    let empty = true; // If, inbetween the linebreak and the starting index, there is nothing but whitespace

    for (index = startingIndex; index < str.length; index++) {
        let char = str.charAt(index);

        if (!isWhitespace(char)) empty = false;
        if (char === '\n') break; // Line break is reached
    }

    return { empty, newLineIndex: index };
}

function stringInsertAt(string, index, substring) {
    return string.slice(0, index) + substring + string.slice(index);
}

const ABSOLUTE_URL_REGEXP = new RegExp('^(?:[a-z]+:)?//', 'i');
function urlIsAbsolute(url) {
    return ABSOLUTE_URL_REGEXP.test(url);
}

function generateRandomHexString(len = 12) {
    let output = '';
    for (let i = 0; i < len; i++) {
        output += (Math.floor(Math.random() * 16)).toString(16);
    }

    return output;
}

class StringSplicer {
    constructor(string) {
        this.string = string;
        this.instructions = [];
    }

    addCut(index, length) {
        this.instructions.push({
            type: 'cut',
            index: index,
            length: length
        });
    }

    addInsert(index, substring) {
        this.instructions.push({
            type: 'insert',
            index: index,
            substring: substring
        });
    }

    execute() {
        let result = this.string;

        // Put all the cuts first
        this.instructions.sort((a, b) => {
            if (a.type === 'cut') return -1;
            else return 1;
        });

        // Sort by index, in descending order. It is important that this sort is stable.
        stableSort.inplace(this.instructions, (a, b) => {
            return b.index - a.index;
        });

        for (let instruction of this.instructions) {
            switch (instruction.type) {
                case 'cut':
                    result = stringCutout(result, instruction.index, instruction.index + instruction.length);
                    break;
                case 'insert':
                    result = stringInsertAt(result, instruction.index, instruction.substring);
                    break;
                default: break;
            }
        }

        return result;
    }
}

// Replaces the \r\n (carriage-return, line-feed) Windows line ending with just \n
function replaceCRLFwithLF(string) {
    return string.replace(/\r\n/g, '\n');
}

exports.LESS_THAN_SIGN_UNICODE = LESS_THAN_SIGN_UNICODE;
exports.cloneObject = cloneObject;
exports.stringCutout = stringCutout;
exports.isWhitespace = isWhitespace;
exports.stringInsertAt = stringInsertAt;
exports.urlIsAbsolute = urlIsAbsolute;
exports.generateRandomHexString = generateRandomHexString;
exports.StringSplicer = StringSplicer;
exports.getLinebreakBefore = getLinebreakBefore;
exports.getLinebreakAfter = getLinebreakAfter;
exports.replaceCRLFwithLF = replaceCRLFwithLF;
exports.indexIsInsideEmptyLine = indexIsInsideEmptyLine;
exports.removeLineIfEmpty = removeLineIfEmpty;