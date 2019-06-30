const path = require('path');
const rollup = require('rollup');
const uglify = require('uglify-es');
const typescript = require('typescript');

const markup = require('./markup.js');
const util = require('./util.js');
const fileUtils = require('./file_utils.js');
const options = require('./options.js');

async function processScriptElements(markupProcessData) {
    markupProcessData.bundler.log("Processing script elements...");

    let scriptBundlers = await getScriptBundlers(markupProcessData);

    let insertPosition = markupProcessData.bundler.options.scriptInsertPosition;
    if (insertPosition === options.OptionConstants.SMART) {
        // Reverse
        for (let i = scriptBundlers.length-1; i >= 0; i--) {
            scriptBundlers[i].cutAndInsert();
        }
    } else {
        // There should be only one bundler
        let bundler = scriptBundlers[0];
        cutElements(bundler.allElements, markupProcessData, true);
        markupProcessData.updateExclusionRanges();

        let insertionIndex = markupProcessData.getIndexByInsertTargetData(options.getTargetDataFromInsertPosition(insertPosition));
        markupProcessData.contents = util.stringInsertAt(markupProcessData.contents, insertionIndex, bundler.finalElements.join(''));
    }

    markupProcessData.updateExclusionRanges();
}

function getScriptElements(markupProcessData) {
    let scriptElements = [];
    let scriptRegExp = /(<script(?: (?:.|\s)*?)?>)((?:.|\s)*?)<\/script(?: (?:.|\s)*?)?>/gi;
    let match;

    while ((match = scriptRegExp.exec(markupProcessData.contents)) !== null) {
        if (markupProcessData.isExcludedIndex(match.index)) continue;

        let openingTag = match[1];
        let body = match[2];

        let src = markup.getHtmlElementAttributeValue(openingTag, 'src');
        let isAsync = markup.htmlElementAttributeIsSet(openingTag, 'async');
        let isDefered = markup.htmlElementAttributeIsSet(openingTag, 'defer');
        let type = markup.getHtmlElementAttributeValue(openingTag, 'type');
        if (type === 'module') isDefered = true; // All modules are defered

        if (isAsync) continue; // Skip async scripts and leave them in markup
        if (!markupProcessData.bundler.options.handleInlineScript && !src) continue;
        if (src && !util.urlIsAbsolute(src) && !fileUtils.navigateFromDirectoryWithRelativePath(markupProcessData.file.parent, src)) {
            // If file doesn't exist
            if (markupProcessData.bundler.options.missingScriptFileTagAction === options.OptionConstants.KEEP) continue;
        }

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

// Get all <script> elements from the markup
async function getScriptBundlers(markupProcessData) {
    let allScriptElements = getScriptElements(markupProcessData);
    let bundlers = [];
    let currentBundler;
    let currentScriptElements = [];

    await addBundler();

    for (let element of allScriptElements) {
        // If insert position is set to SMART, see if there is non-empty text inbetween the two elements. If so, add a new bundler, 'cause we need to break here.
        if (markupProcessData.bundler.options.scriptInsertPosition === options.OptionConstants.SMART) {
            let lastElement = currentScriptElements[currentScriptElements.length - 1];
            if (lastElement) {
                if (!markupProcessData.isEmptyInRange(lastElement.match.index + lastElement.match[0].length, element.match.index)) {
                    await addBundler();
                }
            }
        }

        currentScriptElements.push(element);
    }
    await addBundler();

    async function addBundler() {
        if (currentBundler && currentScriptElements.length) {
            orderScriptElements(currentScriptElements);
            await addScriptElementsToScriptBundler(currentScriptElements, currentBundler);
            bundlers.push(currentBundler);
        }

        currentBundler = new ScriptFileBundler(markupProcessData);
        currentScriptElements.length = 0;
    }

    return bundlers;
}

// Cut out script elements from markup
function cutElements(scriptElements, markupProcessData, alwaysRemoveEmptyLine = false) {
    // Go backwards, in order not to mess up the indexes
    for (let i = scriptElements.length-1; i >= 0; i--) {
        let element = scriptElements[i];
        let match = element.match;
        let removeEmptyLine = i !== 0;

        markupProcessData.contents = util.stringCutout(markupProcessData.contents, match.index, match.index + match[0].length);
        if (removeEmptyLine || alwaysRemoveEmptyLine) markupProcessData.contents = util.removeWhitespaceLine(markupProcessData.contents, match.index);
    }
}

// Move all defered elements to the end of the list, as those get executed last
function orderScriptElements(arr) {
    for (let i = 0, len = arr.length; i < len; i++) {
        let element = arr[i];
        if (!element.isDefered) continue;

        arr.push(element);
        arr.splice(i--, 1);
        len--;
    }
}

async function addScriptElementsToScriptBundler(scriptElements, scriptBundler) {
    for (let element of scriptElements) {
        if (element.src) { // If the script contains a 'src' attribute
            if (util.urlIsAbsolute(element.src)) { // If non-local script
                await scriptBundler.addCurrentBundle();
    
                let elementStr = createScriptElement(element.src, element.isDefered, element.type === 'module');
                scriptBundler.finalElements.push(elementStr);
            } else if (element.type === 'module') { // If module
                await scriptBundler.addCurrentBundle();
                
                let file = fileUtils.navigateFromDirectoryWithRelativePath(scriptBundler.markupProcessData.file.parent, element.src);
                if (!file) continue;
    
                scriptBundler.add(null, file, element);
                await scriptBundler.addCurrentBundle();
            } else { // In all other cases
                let reference = scriptBundler.getCurrentBundleReferenceElement();
                if (reference) {
                    // If the current bundle's defered state doesn't equal this script's defered state, create a new bundle
                    if (reference.isDefered !== element.isDefered) await scriptBundler.addCurrentBundle();
                }
    
                let file = fileUtils.navigateFromDirectoryWithRelativePath(scriptBundler.markupProcessData.file.parent, element.src);
                if (!file) continue;
    
                let contents = file.getContents();
                scriptBundler.add(contents, file, element);
            }
        } else if (element.body) {
            if (element.type === 'module') { // If inline module
                throw new Error("Inline module scripts are currently not bundleable. (in '" + scriptBundler.markupProcessData.file.getRelativePath() + "')");
            } else { // If regular inline script
                let reference = scriptBundler.getCurrentBundleReferenceElement();
                if (reference) {
                    // If the current bundle's defered state doesn't equal this script's defered state, create a new bundle
                    if (reference.isDefered !== element.isDefered) await scriptBundler.addCurrentBundle();
                }

                scriptBundler.add(element.body, null, element);
            }
        }
    }
    await scriptBundler.addCurrentBundle();
}

class ScriptFileBundler {
    constructor(markupProcessData) {
        this.markupProcessData = markupProcessData;
        this.allElements = [];
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
        if (element !== null) {
            this.allElements.push(element);
            this.currentBundleElements.push(element);
        }
    }

    // The first element in the bundle is assumed to contain information applicapable to all elements in the bundle
    getCurrentBundleReferenceElement() {
        return this.currentBundleElements[0];
    }

    // Create a bundle from the current elements
    async addCurrentBundle() {
        if (this.currentBundleElements.length === 0) return;

        let reference = this.getCurrentBundleReferenceElement();
        let bundleDefered = reference.isDefered;
        let bundleIsModule = reference.type === 'module';
        
        // Get existing bundle if possible
        let bundle = this.markupProcessData.bundler.getBundleWithMatchingFiles(this.currentBundleFiles);
        let code;

        if (bundle) {
            code = bundle.getCode();
        } else { // Create new bundle
            let processedFiles = [];

            if (bundleIsModule) {
                // Rollup the ES6 module

                let absolutePath = this.currentBundleFiles[0].getAbsolutePath();
                let rollupBundle = await rollup.rollup({input: absolutePath});
                let output = await rollupBundle.generate({format: 'es'});
                code = output.code;

                // Get all processed files (files the module imports)
                processedFiles = rollupBundle.modules.map((a) => {
                    let filePath = a.id;
                    let filePathArray = filePath.split(path.sep);
                    let relativePath = filePathArray.slice(this.markupProcessData.bundler.srcPathArray.length).join(path.posix.sep);

                    return fileUtils.navigateFromDirectoryWithRelativePath(this.markupProcessData.bundler.root, relativePath);
                });

                bundleIsModule = false; // Script is no longer a module since it's been rolled up
            } else {
                code = this.currentBundleCode;
            }
            code = processCode(code, this.markupProcessData.bundler);
            
            if (this.markupProcessData.bundler.options.injectScript) {
                // Create a virtual bundle
                bundle = this.markupProcessData.bundler.createBundle('.js', this.currentBundleFiles, code, true);
            } else {
                // Create a non-virtual bundle
                bundle = this.markupProcessData.bundler.createBundle('.js', this.currentBundleFiles, code);
            }

            for (let file of this.currentBundleFiles) {
                file.bundles.add(bundle);
            }
            for (let file of processedFiles) {
                if (file) file.bundles.add(bundle);
            }
        }

        if (this.markupProcessData.bundler.options.injectScript) {
            // Sanitize script for injection
            if (this.markupProcessData.bundler.options.sanitizeInjectedScript) code = sanitizeCode(code, this.markupProcessData.bundler);

            let elementStr = createScriptElement(null, bundleDefered, bundleIsModule, code);
            this.finalElements.push(elementStr);
        } else {
            let pathString = fileUtils.getPathFromFileAToFileB(this.markupProcessData.file, bundle.file);
            let elementStr = createScriptElement(pathString, bundleDefered, bundleIsModule);
            this.finalElements.push(elementStr);
        }

        this.currentBundleCode = '';
        this.currentBundleFiles.length = 0;
        this.currentBundleElements.length = 0;
    }

    cutAndInsert() {
        cutElements(this.allElements, this.markupProcessData);
        let beginning = this.allElements[0].match.index;
        this.markupProcessData.contents = util.stringInsertAt(this.markupProcessData.contents, beginning, this.finalElements.join(''));
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

    // Wrap code in IIFE
    if (bundler.options.iifeScript) code = `(function(){\n${code}\n})();`;

    // Transpile
    if (bundler.options.transpileScript !== false) {
        let targetString = null;

        switch (bundler.options.transpileScript) {
            case options.OptionConstants.ES3: targetString = 'ES3'; break;
            case options.OptionConstants.ES5: case true: targetString = 'ES5'; break;
            case options.OptionConstants.ES6: targetString = 'ES6'; break;
            case options.OptionConstants.ES2016: targetString = 'ES2016'; break;
            case options.OptionConstants.ES2017: targetString = 'ES2017'; break;
            case options.OptionConstants.ESNEXT: targetString = 'ESNext'; break;
        }

        if (targetString) {
            // Transpile using TSC. Works surprisingly well!
            let transpilation = typescript.transpileModule(code, {
                compilerOptions: {
                    target: targetString
                }
            });

            let output = transpilation.outputText;
            if (output !== undefined && output !== null) code = output;
        }
    }

    // Minify
    if (bundler.options.minifyScript) {
        let uglifyOptions = {};
        if (bundler.options.uglifyOptionsOverride) {
            Object.assign(uglifyOptions, bundler.options.uglifyOptionsOverride);
        }

        let minification = uglify.minify(code, uglifyOptions);
        
        if (minification.error) throw new Error(minification.error);
        else code = minification.code;
    }

    return code;
}

// Replace '</script' with '\u003c/script' (so that doesn't exit the <script> element)
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