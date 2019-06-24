const path = require('path');
const fs = require('fs-extra');
const copyFileSync = require('fs-copy-file-sync');
const rollup = require('rollup');
const uglify = require('uglify-es');
const htmlMinify = require('html-minifier').minify;
const minimatch = require('minimatch');
const crypto = require('crypto');
const now = require('performance-now');

const Constants = {
    REMOVE_ALL: 0,
    REMOVE_BUNDLED: 1,
    KEEP_ALL: 2
};

const DEFAULT_OPTIONS = {
    src: path.resolve('./src'),
    dist: path.resolve('./dist'),
    verbose: true,

    bundleScripts: true,
    minifyScript: true,
    iifeScript: true,
    bundleCss: true,
    minifyCss: true,
    minifyHtml: true,

    removeEmptyDirectories: true,
    scriptFileAction: Constants.REMOVE_BUNDLED,
    cssFileAction: Constants.REMOVE_BUNDLED,
    keep: [],
    ignore: [],
    ignoreGit: true,
    ignoreDsStore: true,
    
    randomBundleNames: true,
    injectScript: false,
    injectCss: true
};

function pathIsIgnored(relativePath) {
    for (let pattern of options.ignore) {
        if (minimatch(relativePath, pattern, {matchBase: true, dot: true})) return true;
    }

    return false;
}

function pathShouldBeKept(relativePath) {
    for (let pattern of options.keep) {
        if (minimatch(relativePath, pattern, {matchBase: true, dot: true})) return true;
    }

    return false;
}

class FileBase {
    constructor(name = null, parent = null) {
        this.name = name;
        this.parent = parent;
        this.ignored = false;
    }

    getFileTreePosition() {
        let path = [];

        if (this.parent && this.parent.parent) {
            path.unshift(this.parent.name);
            path.unshift(...this.parent.getFileTreePosition());
        }

        return path;
    }

    getParentTree() {
        let arr = [];
        let current = this;

        while (current.parent) {
            arr.unshift(current.parent);
            current = current.parent;
        }

        return arr;
    }

    getAbsolutePath() {
        return getAbsoluteFilePath(this);
    }

    getRelativePath() {
        return getRelativeFilePath(this);
    }
}

function isScriptFile(file) {
    return path.extname(file.name) === '.js';
}

function isCssFile(file) {
    return path.extname(file.name) === '.css';
}

class Directory extends FileBase {
    constructor(name, parent) {
        super(name, parent);

        this.files = [];
    }

    createSubdirectory(name) {
        let newDirectory = new Directory(name, this);
        this.files.push(newDirectory);

        return newDirectory;
    }

    createFile(name) {
        let newFile = new File(name, this);
        this.files.push(newFile);

        return newFile;
    }

    cleanseFiles() {
        for (let file of this.files) {
            if (file === BUNDLE_DIRECTORY || pathShouldBeKept(file.getRelativePath())) continue;

            if (file.constructor === File) {
                if (pathIsIgnored(file.getRelativePath())) file.ignored = true;

                if (isScriptFile(file)) {
                    switch (options.scriptFileAction) {
                        case Constants.REMOVE_ALL: {
                            file.ignored = true;
                        }; break;
                        case Constants.REMOVE_BUNDLED: {
                            if (file.bundles.size > 0) file.ignored = true;
                        }; break;
                        case Constants.KEEP_ALL: {
                            file.ignored = false;
                        }; break;
                    }
                } else if (isCssFile(file)) {
                    switch (options.cssFileAction) {
                        case Constants.REMOVE_ALL: {
                            file.ignored = true;
                        }; break;
                        case Constants.REMOVE_BUNDLED: {
                            if (file.bundles.size > 0) file.ignored = true;
                        }; break;
                        case Constants.KEEP_ALL: {
                            file.ignored = false;
                        }; break;
                    }
                }
            } else if (file.constructor === Directory) {
                file.cleanseFiles();
            }
        }
    }

    cleanseDirectories() {
        let shouldCleanseMyself = false;
        if (this.getDeepFileCount() === 0) shouldCleanseMyself = true;

        for (let file of this.files) {
            if (file.constructor !== Directory) continue;
            let cleanse = file.cleanseDirectories();
            if (cleanse || pathIsIgnored(file.getRelativePath())) file.ignored = true;
        }

        return shouldCleanseMyself;
    }

    getDeepFileCount() {
        let total = 0;

        for (let file of this.files) {
            if (file.constructor === File && !file.ignored) total++;
            else if (file.constructor === Directory) total += file.getDeepFileCount();
        }

        return total;
    }

    write(currentPath) {
        for (let file of this.files) {
            if (file.ignored) continue;

            let destinationPath = path.join(currentPath, file.name);

            if (file.constructor === File) {
                log(`Writing file "${file.getRelativePath()}"...`);

                if (file.contentOverride !== null) {
                    fs.writeFileSync(destinationPath, file.contentOverride);
                } else {
                    let sourcePath = file.getAbsolutePath();

                    copyFileSync(sourcePath, destinationPath);
                }
            } else if (file.constructor === Directory) {
                log(`Creating directory "${file.getRelativePath()}"...`);

                fs.mkdirSync(destinationPath);
                file.write(destinationPath);
            }
        }
    }

    getRelativePath() {
        return getRelativeFilePath(this);
    }
}

class File extends FileBase {
    constructor(name, parent, contentOverride = null) {
        super(name, parent);

        this.contentOverride = contentOverride;
        this.bundles = new Set(); // Set the bundles this file is a part of
    }

    getContents() {
        return fs.readFileSync(this.getAbsolutePath()).toString();
    }
}

function navigateFromDirectoryWithRelativePath(directory, relativePath) {
    let here = directory;
    let steps = relativePath.split(path.posix.sep);

    for (let step of steps) {
        switch (step) {
            case '..': {
                here = here.parent || here;
            }; break;
            case '.': {
                here = here; // Yes, I know this does nothing. It's all for that #clarity!
            }; break;
            default: {
                let index = here.files.findIndex((a) => a.name === step);
                if (index === -1) return null;
                else here = here.files[index];
            };
        }
    }

    return here;
}

const MARKUP_EXTENSIONS = ['.html', '.htm', '.php'];

const ROOT = new Directory();
const BUNDLE_DIRECTORY = ROOT.createSubdirectory('bundles');

let options = null;
let srcPathArray = null;

let bundles = [];

class Bundle {
    constructor(file, files) {
        this.file = file;
        this.files = files;
    }

    filesMatch(files2) {
        if (this.files.length !== files2.length) return false;

        for (let file of files2) {
            if (!this.files.includes(file)) return false;
        }

        return true;
    }
}

const EMPTY_BUNDLE = new Bundle(null, []);

function getPathFromFileAToFileB(a, b) {
    let aParents = a.getParentTree();
    let bParents = b.getParentTree();
    let closestMutualParent;
    let wentBackSteps = 0;

    outer:
    for (let i = aParents.length - 1; i >= 0; i--) {
        let aParent = aParents[i];

        for (let bParent of bParents) {
            if (bParent === aParent) {
                closestMutualParent = aParent;
                break outer;
            }
        }

        wentBackSteps++;
    }

    let pathElements = [];
    if (wentBackSteps === 0) {
        pathElements.push('.');
    } else {
        for (let i = 0; i < wentBackSteps; i++) pathElements.push('..');
    }

    let index = bParents.findIndex((a) => a === closestMutualParent) + 1;
    let directory;
    while ((directory = bParents[index]) !== undefined) {
        pathElements.push(directory.name);
        index++;
    }

    pathElements.push(b.name);

    return pathElements.join(path.posix.sep);
}

function generateNextBundleName() {
    if (options.randomBundleNames) {
        let index = null, name;
        while (index !== -1) {
            name = generateRandomHexString();
            index = bundles.findIndex((a) => a.file.indexOf(name) === 0);
        }

        return name;
    }
    return bundles.length;
}

function createBundle(extension, files, data) {
    files = files.slice(0);

    for (let b of bundles) {
        if (b.filesMatch(files)) return b;
    }

    let bundleFile = BUNDLE_DIRECTORY.createFile(generateNextBundleName() + extension);
    bundleFile.contentOverride = data;

    let bundle = new Bundle(bundleFile, files);
    bundles.push(bundle);

    log(`Created bundle "${bundleFile.name}".`)

    return bundle;
}

function cloneObject(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function constructFileTree(directoryPath, directory) {
    let files = fs.readdirSync(directoryPath);
    
    for (let fileName of files) {
        let filePath = path.join(directoryPath, fileName);
        let fileStats = fs.lstatSync(filePath);

        if (fileStats.isDirectory()) {
            let newDirectory = directory.createSubdirectory(fileName);

            constructFileTree(filePath, newDirectory);
        } else {
            directory.createFile(fileName);
        }
    }
}

function getAbsoluteFilePath(file, isPosix = false) {
    let args = [options.src, ...file.getFileTreePosition(), file.name];

    if (isPosix) return path.posix.join(...args);
    else return path.join(...args);
}

function getRelativeFilePath(file, isPosix = true) {
    let args = [...file.getFileTreePosition(), file.name];

    if (isPosix) return path.posix.join(...args);
    else return path.join(...args);
}

async function processMarkup(file) {
    log(`Processing "${file.getRelativePath()}"...`);
    
    let contents = file.getContents();

    let markupProcessObject = {
        file,
        contents,
        exclusionRanges: [],
    };

    updateExclusionRanges(markupProcessObject);
    if (options.bundleScripts) processStyleElements(markupProcessObject);
    if (options.bundleCss) await processScriptElements(markupProcessObject);
    if (options.minifyHtml) minifyMarkup(markupProcessObject);

    file.contentOverride = markupProcessObject.contents;
}

function minifyMarkup(obj) {
    log(`Minifying "${obj.file.getRelativePath()}"...`);

    obj.contents = htmlMinify(obj.contents, {
        collapseWhitespace: true,
        conservativeCollapse: true,
        removeComments: true
    });
}

function isPHPFile(file) {
    return path.extname(file.name).toLowerCase() === '.php';
}

function isExcludedIndex(markupProcessObject, index) {
    for (let exclusionRange of markupProcessObject.exclusionRanges) {
        if (index >= exclusionRange.start && index < exclusionRange.end) return true;
    }
    return false;
}

function processStyleElements(obj) {
    log("Processing style elements...");

    let linkRegExp = /<link (.|\n)*?>/gi;
    let match;
    let currentBundleCode = '';
    let currentBundleFiles = [];
    let finalElements = [];

    while ((match = linkRegExp.exec(obj.contents)) !== null) {
        let matchString = match[0];
        if (isExcludedIndex(obj, match.index)) continue;
        if (!linkElementIsStyleElement(matchString)) continue;

        let url = getHtmlElementAttributeValue(matchString, 'href');
        if (!url) continue; // Error here?

        if (urlIsAbsolute(url)) {
            addCurrentBundle();

            finalElements.push(`<link rel="stylesheet" href="${url}">`);
        } else {
            let file = navigateFromDirectoryWithRelativePath(obj.file.parent, url);
            if (!file) continue; // Just IGNORE the statement if it points to no file. Maybe throw?

            let contents = file.getContents();

            if (currentBundleFiles.length > 0) currentBundleCode += '\n\n';
            currentBundleCode += contents;
            currentBundleFiles.push(file);
        }

        obj.contents = stringCutout(obj.contents, match.index, match.index + matchString.length);
        obj.contents = removeWhitespaceLine(obj.contents, match.index);
        updateExclusionRanges(obj);

        linkRegExp.lastIndex -= matchString.length;
    }
    addCurrentBundle();
    
    function addCurrentBundle() {
        if (currentBundleFiles.length === 0) return;

        let code = options.minifyCss? minifyCss(currentBundleCode) : currentBundleCode;
        let bundle;

        if (options.injectCss) {
            bundle = EMPTY_BUNDLE;

            finalElements.push(`<style>${code}</style>`);
        } else {
            bundle = createBundle('.css', currentBundleFiles, code);
            let pathString = getPathFromFileAToFileB(obj.file, bundle.file);

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
    obj.contents = stringInsertAt(obj.contents, closingHeadTagIndex, insertString);

    updateExclusionRanges(obj);
}

async function processScriptElements(obj) {
    log("Processing script elements...");

    let scriptRegExp = /<script(.|\n)*?<\/script>/gi;
    let match;

    let scriptElements = [];

    while ((match = scriptRegExp.exec(obj.contents)) !== null) {
        let matchString = match[0];
        if (isExcludedIndex(obj, match.index)) continue;

        let openingTag = /<script(.|\n)*?>/i.exec(matchString)[0];
        let src = getHtmlElementAttributeValue(openingTag, 'src');
        let isAsync = htmlElementAttributeIsSet(openingTag, 'async');
        let isDefered = htmlElementAttributeIsSet(openingTag, 'defer');
        let type = getHtmlElementAttributeValue(openingTag, 'type');
        if (type === 'module') isDefered = true; // All modules are defered

        if (isAsync) continue;

        scriptElements.push({
            src,
            isDefered,
            type
        });

        obj.contents = stringCutout(obj.contents, match.index, match.index + matchString.length);
        obj.contents = removeWhitespaceLine(obj.contents, match.index);
        updateExclusionRanges(obj);

        scriptRegExp.lastIndex -= matchString.length;
    }

    let currentBundleCode = '';
    let currentBundleFiles = [];
    let currentBundleElements = [];
    let finalElements = [];

    // Move all defered elements to the end of the list
    for (let i = 0, len = scriptElements.length; i < len; i++) {
        let element = scriptElements[i];
        if (!element.isDefered) continue;

        scriptElements.push(element);
        scriptElements.splice(i--, 1);
        len--;
    }

    for (let element of scriptElements) {
        if (urlIsAbsolute(element.src)) {
            await addCurrentBundle();

            let element = createScriptElement(element.src, element.isDefered, element.type === 'module');
            finalElements.push(element);
        } else if (element.type === 'module') {
            await addCurrentBundle();

            let file = navigateFromDirectoryWithRelativePath(obj.file.parent, element.src);
            if (!file) continue; // THROW??

            currentBundleFiles.push(file);
            currentBundleElements.push(element);

            await addCurrentBundle();
        } else {
            let reference = getCurrentBundleReferenceElement();
            if (reference) {
                let shouldAddBundle = false;

                if (reference.isDefered !== element.isDefered) shouldAddBundle = true;

                if (shouldAddBundle) await addCurrentBundle();
            }

            let file = navigateFromDirectoryWithRelativePath(obj.file.parent, element.src);
            if (!file) continue; // Just IGNORE the statement if it points to no file. Maybe throw?

            let contents = file.getContents();

            if (currentBundleFiles.length > 0) currentBundleCode += '\n\n';
            currentBundleCode += contents;
            currentBundleFiles.push(file);
            currentBundleElements.push(element);
        }
    }
    await addCurrentBundle();

    function getCurrentBundleReferenceElement() {
        return currentBundleElements[0];
    }

    function createScriptElement(src, isDefered = false, isModule = false, body) {
        let elementStr = `<script`;
        if (src) elementStr += ` src="${src}"`;
        if (isDefered && !isModule) elementStr += ' defer';
        if (isModule) elementStr += ' type="module"';
        elementStr += '>';
        if (body) elementStr += body;
        elementStr += '</script>';

        return elementStr;
    }

    function processCode(code) {
        log("Processing script...");

        if (options.iifeScript) code = `(function(){\n${code}\n})();`;
        if (options.minifyScript) code = uglify.minify(code, {}).code;

        return code;
    }

    async function addCurrentBundle() {
        if (currentBundleFiles.length === 0) return;

        let reference = getCurrentBundleReferenceElement();
        let bundleDefered = reference.isDefered;
        let bundleIsModule = reference.type === 'module';

        let code, processedFiles = [];
        if (bundleIsModule) {
            let absolutePath = currentBundleFiles[0].getAbsolutePath();
            let rollupBundle = await rollup.rollup({input: absolutePath});
            let output = await rollupBundle.generate({format: 'es'});
            code = output.code;

            processedFiles = rollupBundle.modules.map((a) => {
                let filePath = a.id;
                let filePathArray = filePath.split(path.sep);
                let relativePath = filePathArray.slice(srcPathArray.length).join(path.posix.sep);

                return navigateFromDirectoryWithRelativePath(ROOT, relativePath);
            });

            bundleIsModule = false; // Script is no longer a module since it's been rolled up
        } else {
            code = currentBundleCode;
        }
        code = processCode(code);
        
        let bundle;
        if (options.injectScript) {
            bundle = EMPTY_BUNDLE;

            let elementStr = createScriptElement(null, bundleDefered, bundleIsModule, code);
            finalElements.push(elementStr);
        } else {
            bundle = createBundle('.js', currentBundleFiles, code);
            let pathString = getPathFromFileAToFileB(obj.file, bundle.file);
            
            let elementStr = createScriptElement(pathString, bundleDefered, bundleIsModule);
            finalElements.push(elementStr);
        }

        for (let file of currentBundleFiles) {
            file.bundles.add(bundle);
        }
        for (let file of processedFiles) {
            if (file) file.bundles.add(bundle);
        }

        currentBundleCode = '';
        currentBundleFiles.length = 0;
        currentBundleElements.length = 0;
    }

    let insertString = '';
    for (let element of finalElements) {
        insertString += element;
    }

    let closingBodyTagIndex = obj.contents.search(/<\/body>/i);
    obj.contents = stringInsertAt(obj.contents, closingBodyTagIndex, insertString);

    updateExclusionRanges(obj);
}

function minifyCss(str) {
    log("Processing CSS...");
    
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
            while (isWhitespace(str[index2])) {
                index2--;
            }
            str = str.slice(0, index2+1) + str.slice(index);
            index -= (index-index2-1);
        }
        if (char === '{' || char === '}' || char === ':' || char === ';' || char === ',') {
            let index2 = index+1;
            while (isWhitespace(str[index2])) {
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

function excludePhpBlocks(obj) {
    let phpStartRegEx = /(<\?php|<\?=)/gi;
    let phpEndRegEx = /\?>/g;
    let match;

    while ((match = phpStartRegEx.exec(obj.contents)) !== null) {
        let start = match.index;
        let end;

        if (isExcludedIndex(obj, start)) continue;

        phpEndRegEx.lastIndex = start;
        let endMatch = phpEndRegEx.exec(obj.contents);

        if (endMatch) {
            end = endMatch.index + endMatch[0].length;
        } else {
            end = obj.contents.length;
        }

        obj.exclusionRanges.push({start, end});
    }
}

function excludeHtmlComments(obj) {
    let htmlCommentStartRegEx = /<!--/g;
    let htmlCommentEndRegEx = /-->/g;
    let match;

    while ((match = htmlCommentStartRegEx.exec(obj.contents)) !== null) {
        let start = match.index;
        let end;

        if (isExcludedIndex(obj, start)) continue;

        htmlCommentEndRegEx.lastIndex = start;
        let endMatch = htmlCommentEndRegEx.exec(obj.contents);

        if (endMatch) {
            end = endMatch.index + endMatch[0].length;
        } else {
            end = obj.contents.length;
        }

        obj.exclusionRanges.push({start, end});
    }
}

function updateExclusionRanges(obj) {
    obj.exclusionRanges.length = 0;

    if (isPHPFile(obj.file)) excludePhpBlocks(obj);
    excludeHtmlComments(obj);
}

async function processDirectory(directory) {
    for (let file of directory.files) {
        if (file === BUNDLE_DIRECTORY) continue;

        if (file.constructor === File) {
            let extension = path.extname(file.name).toLowerCase();

            if (MARKUP_EXTENSIONS.includes(extension)) {
                if (!pathIsIgnored(file.getRelativePath())) await processMarkup(file);
            }
        } else if (file.constructor === Directory) {
            await processDirectory(file);
        }
    }
}

function generateRandomBase64String(len = 12) {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    let bytes = crypto.randomBytes(len);
    for (var i = 0; i < bytes.length; i++) {
        text += possible.charAt(bytes[i] % 64);
    }

    return text;
}

function generateRandomHexString(len = 12) {
    let output = '';
    for (let i = 0; i < len; i++) {
        output += (Math.floor(Math.random() * 16)).toString(16);
    }

    return output;
}

function writeToDist() {
    log('Creating "dist" folder...');
    fs.removeSync(options.dist);
    fs.mkdirSync(options.dist);

    ROOT.write(options.dist);
}

function log(text) {
    if (options.verbose) console.log('[sarcina] ' + text);
}

async function main(optionsOverride) {
    let start = now();

    options = cloneObject(DEFAULT_OPTIONS);
    if (typeof optionsOverride === 'object') Object.assign(options, optionsOverride);

    options.src = path.resolve(options.src);
    options.dist = path.resolve(options.dist);

    log("Starting bundling process...\n\n\tSource directory:\n\t" + options.src + '\n\n\tTarget directory:\n\t' + options.dist + '\n');

    srcPathArray = options.src.split(path.sep);

    if (options.ignoreGit) options.ignore.push('*.gitignore', '*.git');
    if (options.ignoreDsStore) options.ignore.push('*.DS_Store');

    log("Constructing file tree...");
    constructFileTree(options.src, ROOT);
    log("Processing files...");
    await processDirectory(ROOT);
    log("Cleaning up...");
    ROOT.cleanseFiles();
    if (options.removeEmptyDirectories) ROOT.cleanseDirectories();
    log("Writing files...");
    writeToDist();

    let elapsed = now() - start;

    log("Bundling successful. Took " + (elapsed / 1000).toFixed(3) + " seconds.");
}

exports.bundle = main;

for (let key in Constants) {
    exports[key] = Constants[key];
}