function cloneObject(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function stringCutout(str, start, end) {
    return str.slice(0, start) + str.slice(end);
}

function isWhitespace(char) {
    return char === ' ' || char === '\n' || char === '\r' || char === '\t';
}

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

exports.cloneObject = cloneObject;
exports.stringCutout = stringCutout;
exports.isWhitespace = isWhitespace;
exports.removeWhitespaceLine = removeWhitespaceLine;
exports.stringInsertAt = stringInsertAt;
exports.urlIsAbsolute = urlIsAbsolute;
exports.generateRandomHexString = generateRandomHexString;