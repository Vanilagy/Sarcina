const path = require('path');
const rollup = require('rollup');
const uglify = require('uglify-es');

const markup = require('./markup.js');
const util = require('./util.js');
const fileUtils = require('./file_utils.js');
const bundler = require('./bundler.js');

async function processScriptElements(obj) {
    obj.bundler.log("Processing script elements...");

    let scriptElements = getScriptElements(obj);
    cutElements(scriptElements, obj);
    orderScriptElements(scriptElements);

    let scriptBundler = new ScriptFileBundler(obj);
    await addScriptElementsToScriptBundler(scriptElements, scriptBundler, obj);

    let insertString = '';
    for (let element of scriptBundler.finalElements) {
        insertString += element;
    }

    let closingBodyTagIndex = obj.contents.search(/<\/body>/i);
    obj.contents = util.stringInsertAt(obj.contents, closingBodyTagIndex, insertString);

    obj.updateExclusionRanges();
}

function getScriptElements(obj) {
    let scriptElements = [];
    let scriptRegExp = /(<script(?: (?:.|\s)*?)?>)((?:.|\s)*?)<\/script(?: (?:.|\s)*?)?>/gi;
    let match;

    while ((match = scriptRegExp.exec(obj.contents)) !== null) {
        if (obj.isExcludedIndex(match.index)) continue;

        let openingTag = match[1];
        let body = match[2];

        let src = markup.getHtmlElementAttributeValue(openingTag, 'src');
        let isAsync = markup.htmlElementAttributeIsSet(openingTag, 'async');
        let isDefered = markup.htmlElementAttributeIsSet(openingTag, 'defer');
        let type = markup.getHtmlElementAttributeValue(openingTag, 'type');
        if (type === 'module') isDefered = true; // All modules are defered

        if (isAsync) continue;
        if (!obj.bundler.options.handleInlineScripts && !src) continue;

        scriptElements.push({
            src,
            match,
            isDefered,
            type,
            body
        });
    }

    return scriptElements;
}

function cutElements(scriptElements, obj) {
    for (let i = scriptElements.length-1; i >= 0; i--) {
        let element = scriptElements[i];
        let match = element.match;

        obj.contents = util.stringCutout(obj.contents, match.index, match.index + match[0].length);
        obj.contents = util.removeWhitespaceLine(obj.contents, match.index);
    }

    obj.updateExclusionRanges();
}

function orderScriptElements(arr) {
    // Move all defered elements to the end of the list
    for (let i = 0, len = arr.length; i < len; i++) {
        let element = arr[i];
        if (!element.isDefered) continue;

        arr.push(element);
        arr.splice(i--, 1);
        len--;
    }
}

async function addScriptElementsToScriptBundler(scriptElements, scriptBundler, obj) {
    for (let element of scriptElements) {
        if (element.src) {
            if (util.urlIsAbsolute(element.src)) {
                await scriptBundler.addCurrentBundle();
    
                let element = createScriptElement(element.src, element.isDefered, element.type === 'module');
                scriptBundler.finalElements.push(element);
            } else if (element.type === 'module') {
                await scriptBundler.addCurrentBundle();
                
                let file = fileUtils.navigateFromDirectoryWithRelativePath(obj.file.parent, element.src);
                if (!file) continue; // THROW??
    
                scriptBundler.add(null, file, element);
                await scriptBundler.addCurrentBundle();
            } else {
                let reference = scriptBundler.getCurrentBundleReferenceElement();
                if (reference) {
                    if (reference.isDefered !== element.isDefered) await scriptBundler.addCurrentBundle();
                }
    
                let file = fileUtils.navigateFromDirectoryWithRelativePath(obj.file.parent, element.src);
                if (!file) continue; // Just IGNORE the statement if it points to no file. Maybe throw?
    
                let contents = file.getContents();
                scriptBundler.add(contents, file, element);
            }
        } else if (element.body) {
            if (element.type === 'module') {
                throw new Error("Inline module scripts are currently not bundleable (in '" + obj.file.getRelativePath() + "')");
            } else {
                let reference = scriptBundler.getCurrentBundleReferenceElement();
                if (reference) {
                    if (reference.isDefered !== element.isDefered) await scriptBundler.addCurrentBundle();
                }

                scriptBundler.add(element.body, null, element);
            }
        }
    }
    await scriptBundler.addCurrentBundle();
}

class ScriptFileBundler {
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

    getCurrentBundleReferenceElement() {
        return this.currentBundleElements[0];
    }

    async addCurrentBundle() {
        if (this.currentBundleElements.length === 0) return;

        let reference = this.getCurrentBundleReferenceElement();
        let bundleDefered = reference.isDefered;
        let bundleIsModule = reference.type === 'module';
        
        let bundle = this.markupProcessObject.bundler.getBundleWithMatchingFiles(this.currentBundleFiles);
        let code;

        if (bundle) {
            code = bundle.getCode();
        } else {
            let processedFiles = [];

            if (bundleIsModule) {
                let absolutePath = this.currentBundleFiles[0].getAbsolutePath();
                let rollupBundle = await rollup.rollup({input: absolutePath});
                let output = await rollupBundle.generate({format: 'es'});
                code = output.code;

                processedFiles = rollupBundle.modules.map((a) => {
                    let filePath = a.id;
                    let filePathArray = filePath.split(path.sep);
                    let relativePath = filePathArray.slice(this.markupProcessObject.bundler.srcPathArray.length).join(path.posix.sep);

                    return fileUtils.navigateFromDirectoryWithRelativePath(this.markupProcessObject.bundler.root, relativePath);
                });

                bundleIsModule = false; // Script is no longer a module since it's been rolled up
            } else {
                code = this.currentBundleCode;
            }
            code = processCode(code, this.markupProcessObject.bundler);
            
            if (this.markupProcessObject.bundler.options.injectScript) {
                bundle = this.markupProcessObject.bundler.createBundle('.js', this.currentBundleFiles, code, true);
            } else {
                bundle = this.markupProcessObject.bundler.createBundle('.js', this.currentBundleFiles, code);
            }

            for (let file of this.currentBundleFiles) {
                file.bundles.add(bundle);
            }
            for (let file of processedFiles) {
                if (file) file.bundles.add(bundle);
            }
        }

        if (this.markupProcessObject.bundler.options.injectScript) {
            if (this.markupProcessObject.bundler.options.sanitizeInjectedScript) code = sanitizeCode(code, this.markupProcessObject.bundler);

            let elementStr = createScriptElement(null, bundleDefered, bundleIsModule, code);
            this.finalElements.push(elementStr);
        } else {
            let pathString = fileUtils.getPathFromFileAToFileB(this.markupProcessObject.file, bundle.file);
            let elementStr = createScriptElement(pathString, bundleDefered, bundleIsModule);
            this.finalElements.push(elementStr);
        }

        this.currentBundleCode = '';
        this.currentBundleFiles.length = 0;
        this.currentBundleElements.length = 0;
    }
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

function processCode(code, bundler) {
    bundler.log("Processing script...");

    if (bundler.options.iifeScript) code = `(function(){\n${code}\n})();`;
    if (bundler.options.minifyScript) code = uglify.minify(code, {}).code;

    return code;
}

function sanitizeCode(code, bundler) {
    bundler.log("Sanitizing script for injection...");

    let scriptEndTagRegEx = /<\/script/gi;
    let match;

    while ((match = scriptEndTagRegEx.exec(code)) !== null) {
        let index = match.index;

        code = code.slice(0, index) + util.LESS_THAN_SIGN_UNICODE + code.slice(index + 1);
    }

    return code;
}

exports.processScriptElements = processScriptElements;