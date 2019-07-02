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

// If the line containing the given index in the string is whitespace-only, remove it
function removeWhitespaceLine(str, index) {
    let newlineBefore = str.lastIndexOf('\n', index-1);
    let newlineAfter = str.indexOf('\n', index);

    if (newlineBefore !== -1 && newlineAfter !== -1) {
        let onlyWhitespace = true;
        for (let index = newlineBefore; index < newlineAfter; index++) {
            let char = str[index];
            if (!isWhitespace(char)) {
                onlyWhitespace = false;
                break;
            }
        }

        if (onlyWhitespace) {
            str = str.slice(0, newlineBefore) + str.slice(newlineAfter);
        }
    }

    return str;
}

function isEmptyFromLinebreak(str, endingIndex) {
    let index;

    for (index = endingIndex - 1; index >= 0; index--) {
        let char = str.charAt(index);

        if (!isWhitespace(char)) return { result: false };
        if (char === '\n') break;
    }

    return { result: true, newLineIndex: index };
}

function isEmptyUntilLinebreak(str, startingIndex) {
    let index;

    for (index = startingIndex; index < str.length; index++) {
        let char = str.charAt(index);

        if (!isWhitespace(char)) return { result: false };
        if (char === '\n') break; // Line break is reached
    }

    return { result: true, newLineIndex: index };
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
exports.removeWhitespaceLine = removeWhitespaceLine;
exports.stringInsertAt = stringInsertAt;
exports.urlIsAbsolute = urlIsAbsolute;
exports.generateRandomHexString = generateRandomHexString;
exports.StringSplicer = StringSplicer;
exports.isEmptyFromLinebreak = isEmptyFromLinebreak;
exports.isEmptyUntilLinebreak = isEmptyUntilLinebreak;
exports.replaceCRLFwithLF = replaceCRLFwithLF;