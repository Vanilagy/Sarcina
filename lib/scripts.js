const path = require('path');
const rollup = require('rollup');
const uglify = require('uglify-es');
const typescript = require('typescript');
const assert = require('assert');
const stableSort = require('stable');
const rollupPluginHypothetical = require('rollup-plugin-hypothetical');

const markup = require('./markup.js');
const util = require('./util.js');
const fileUtils = require('./file_utils.js');
const options = require('./options.js');

async function processScriptElements(markupProcessData) {
    markupProcessData.bundler.log("Processing script elements...");

    if (markupProcessData.bundler.options.bundleScript) await bundleScripts(markupProcessData);
    else await labelNecessaryScriptFiles(markupProcessData);
}

async function bundleScripts(markupProcessData) {
    let scriptBundlers = await getScriptBundlers(markupProcessData);
    let stringSplicer = new util.StringSplicer(markupProcessData.contents);

    for (let bundler of scriptBundlers) {
        let isLocalBundler = bundler.insertPosition === options.OptionConstants.LOCAL;

        bundler.sortElementsByIndex();

        for (let element of bundler.allElements) {
            let start = element.match.index;
            let end = start + element.match[0].length;

            let emptyBefore = util.isEmptyFromLinebreak(markupProcessData.contents, start);
            let emptyAfter = util.isEmptyUntilLinebreak(markupProcessData.contents, end);

            if (emptyBefore.result === true && emptyAfter.result === true) {
                start = emptyBefore.newLineIndex;
                end = emptyAfter.newLineIndex;
            }

            // Aka don't cut the whitespace infront of the first element
            if (isLocalBundler) start = Math.max(start, bundler.allElements[0].match.index);
            
            stringSplicer.addCut(start, end - start);
        }

        if (isLocalBundler) {
            let insertIndex = bundler.allElements[0].match.index; // Beginning of first element
            stringSplicer.addInsert(insertIndex, bundler.finalElements.join(''));
        } else {
            let insertIndex = markupProcessData.getIndexByInsertTargetData(options.getTargetDataFromInsertPosition(bundler.insertPosition));
            stringSplicer.addInsert(insertIndex, bundler.finalElements.join(''));
        }
    }

    let result = stringSplicer.execute();
    markupProcessData.contents = result;

    markupProcessData.updateExclusionRanges();
}

async function labelNecessaryScriptFiles(markupProcessData) {
    let scriptElements = getScriptElements(markupProcessData);

    for (let element of scriptElements) {
        let { file, type } = element;
        if (!file || file.isNecessary) continue;

        if (type === 'module' && !markupProcessData.bundler.necessaryModuleFiles.has(file)) {
            markupProcessData.bundler.log("Resolving ES6 module dependencies...")

            let rolledUp = await rollup.rollup({
                input: file.getAbsolutePath(),
                onwarn: () => {} // Silence the warnings
            });
            let files = getFilesFromRollupModuleData(rolledUp.modules, markupProcessData.bundler);

            for (let moduleFile of files) {
                if (moduleFile) moduleFile.isNecessary = true;
            }

            markupProcessData.bundler.necessaryModuleFiles.add(file);
        }

        file.isNecessary = true;
    }
}

// Get all <script> elements from the markup
function getScriptElements(markupProcessData) {
    let scriptElements = [];
    let scriptRegExp = /(<script(?: (?:.|\s)*?)?>)((?:.|\s)*?)<\/script(?: (?:.|\s)*?)?>/gi;
    let match;
    let previousIndex;

    while (true) {
        previousIndex = scriptRegExp.lastIndex;
        match = scriptRegExp.exec(markupProcessData.contents);

        if (match === null) break;

        if (markupProcessData.isExcludedIndex(match.index)) continue;

        let openingTag = match[1];
        let body = match[2];

        let src = markup.getHtmlElementAttributeValue(openingTag, 'src');
        let isAsync = markup.htmlElementAttributeIsSet(openingTag, 'async');
        if (!src) isAsync = false; // Only elements with src can be async
        let isDefered = markup.htmlElementAttributeIsSet(openingTag, 'defer');
        if (!src) isDefered = false; // Only elements with src can be defered
        // Note: If both defer and async are set, browsers will execute the script async-ly
        let type = markup.getHtmlElementAttributeValue(openingTag, 'type');
        if (type === 'module') isDefered = true; // All modules are defered

        let absolute = util.urlIsAbsolute(src || '');
        let file = null;
        if (src && !absolute) file = fileUtils.navigateFromDirectoryWithRelativePath(markupProcessData.file.parent, src);

        if (!markupProcessData.bundler.options.handleInlineScript && !src) continue;
        if (src && !absolute && !file) {
            // If file doesn't exist
            let action = markupProcessData.bundler.options.missingScriptFileTagAction;
            if (action === options.OptionConstants.KEEP) continue; // Skip over this element
            else if (action === options.OptionConstants.REMOVE) {
                // Cut it out
                markupProcessData.contents = util.stringCutout(markupProcessData.contents, match.index, match.index + match[0].length);
                markupProcessData.contents = util.removeWhitespaceLine(markupProcessData.contents, match.index);
                markupProcessData.updateExclusionRanges();

                // Jump back to where the scan began this iteration
                scriptRegExp.lastIndex = previousIndex;

                continue;
            }
        }

        scriptElements.push({
            src,
            match,
            isAsync,
            isDefered,
            type,
            body,
            file
        });
    }

    return scriptElements;
}

async function getScriptBundlers(markupProcessData) {
    let allScriptElements = getScriptElements(markupProcessData);
    let bundlers = [];
    let currentBundler;
    let currentScriptElements = [];

    await addBundler();

    for (let element of allScriptElements) {
        if (element.isAsync) {
            await addBundler();

            currentScriptElements.push(element);
            await addBundler();
            
            continue;
        }

        // If insert position is set to LOCAL, see if there is non-empty text inbetween the two elements. If so, add a new bundler, 'cause we need to break here.
        if (markupProcessData.bundler.options.scriptInsertPosition === options.OptionConstants.LOCAL) {
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
        let { src, file, isDefered, isAsync, type, body } = element;

        if (src) { // If the script contains a 'src' attribute
            if (util.urlIsAbsolute(src)) { // If non-local script
                await scriptBundler.addCurrentBundle();
    
                let attributes = {
                    src: src
                };
                if (isDefered) attributes.defer = undefined;
                if (isAsync) attributes.async = undefined;
                if (type) attributes.type = type;

                let elementStr = createScriptElement(attributes);
                scriptBundler.finalElements.push(elementStr);
            } else if (element.type === 'module') { // If module
                await scriptBundler.addCurrentBundle();

                assert(file);
    
                scriptBundler.add(null, file, element);
                await scriptBundler.addCurrentBundle();
            } else { // In all other cases
                let reference = scriptBundler.getCurrentBundleReferenceElement();
                if (reference) {
                    // If the current bundle's defered state doesn't equal this script's defered state, create a new bundle
                    if (reference.isDefered !== isDefered) await scriptBundler.addCurrentBundle();
                }

                assert(file);
    
                let contents = file.getRawContents();
                scriptBundler.add(contents, file, element);
            }
        } else if (body) {
            if (type === 'module') { // If inline module
                await scriptBundler.addCurrentBundle();

                scriptBundler.add(body, null, element);
                await scriptBundler.addCurrentBundle();
            } else { // If regular inline script
                let reference = scriptBundler.getCurrentBundleReferenceElement();
                if (reference) {
                    // If the current bundle's defered state doesn't equal this script's defered state, create a new bundle
                    if (reference.isDefered !== isDefered) await scriptBundler.addCurrentBundle();
                }

                scriptBundler.add(body, null, element);
            }
        }
    }
    await scriptBundler.addCurrentBundle();
}

class ScriptFileBundler {
    constructor(markupProcessData) {
        this.markupProcessData = markupProcessData;
        this.insertPosition = this.markupProcessData.bundler.options.scriptInsertPosition;
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
        let bundleAsync = reference.isAsync;
        let bundleIsModule = reference.type === 'module';
        if (reference.isAsync) this.insertPosition = options.OptionConstants.LOCAL; // Due to their nature, async scripts should always be inserted were they were found
        
        // Get existing bundle if possible
        let bundle = this.markupProcessData.bundler.getBundleWithMatchingFiles(this.currentBundleFiles);
        let code;

        if (bundle) {
            code = bundle.getCode();
        } else { // Create new bundle
            let processedFiles = [];

            if (bundleIsModule) {
                let result;

                if (!reference.src) {
                    result = await rollupCode(this.currentBundleCode, this.markupProcessData);
                } else {
                    assert(this.currentBundleFiles.length === 1);

                    let file = this.currentBundleFiles[0]; // This should be the only file in the array
                    result = await rollupFile(file, this.markupProcessData.bundler);
                }

                code = result.code;
                processedFiles.push(...result.processedFiles);
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

        // Non-modules were never modules, and modules have now been rolled up; so this can always be false.
        bundleIsModule = false;

        if (this.markupProcessData.bundler.options.injectScript) {
            // Sanitize script for injection
            if (this.markupProcessData.bundler.options.sanitizeInjectedScript) code = sanitizeCode(code, this.markupProcessData.bundler);

            // We can ignore defer and async for inline scripts, as those are ignored by the browser for inline scripts
            let attributes = {};
            if (bundleIsModule) attributes.type = 'module';

            let elementStr = createScriptElement(attributes, code);
            this.finalElements.push(elementStr);
        } else {
            let pathString = fileUtils.getPathFromFileAToFileB(this.markupProcessData.file, bundle.file);
            let attributes = {
                src: pathString,
            };
            if (bundleDefered) attributes.defer = undefined;
            if (bundleAsync) attributes.async = undefined;
            if (bundleIsModule) attributes.type = 'module';

            let elementStr = createScriptElement(attributes);
            this.finalElements.push(elementStr);
        }

        this.currentBundleCode = '';
        this.currentBundleFiles.length = 0;
        this.currentBundleElements.length = 0;
    }

    sortElementsByIndex() {
        stableSort.inplace(this.allElements, (a, b) => a.match.index - b.match.index); // Sort by index
    }
}

function createScriptElement(attributes = {}, body) {
    let elementStr = `<script`;

    for (let attributeName in attributes) {
        let value = attributes[attributeName];

        elementStr += ` ${attributeName}`;
        if (typeof value === 'string') elementStr += `="${value}"`;
        else if (typeof value === 'boolean') elementStr += `="${value}"`;
    }

    elementStr += '>';
    if (body) elementStr += body;
    elementStr += '</script>';

    return elementStr;
}

// Rollup an ES6 module script file
async function rollupFile(file, bundler) {
    bundler.log("Resolving ES6 module...");

    let absolutePath = file.getAbsolutePath();
    let rollupBundle = await rollup.rollup({
        input: absolutePath,
        onwarn: () => {} // Silence the warnings
    });
    let output = await rollupBundle.generate({format: 'es'});
    let code = output.code;

    // Get all processed files (files the module imports)
    let processedFiles = getFilesFromRollupModuleData(rollupBundle.modules, bundler);

    return { code, processedFiles };
}

async function rollupCode(code, markupProcessData) {
    markupProcessData.bundler.log("Resolving ES6 module...");

    let randomFileName = util.generateRandomHexString() + '.js';
    let randomFilePath = path.join(markupProcessData.file.parent.getAbsolutePath(), randomFileName);

    let rollupBundle = await rollup.rollup({
        input: randomFilePath,
        plugins: [
            rollupPluginHypothetical({
                files: {
                    [randomFilePath]: code
                },
                allowFallthrough: true
            })
        ],
        onwarn: () => {} // Silence the warnings
    });
    let output = await rollupBundle.generate({format: 'es'});

    // Get all processed files (files the module imports)
    let processedFiles = getFilesFromRollupModuleData(rollupBundle.modules, markupProcessData.bundler);

    return { code: output.code, processedFiles };
}

function getFilesFromRollupModuleData(data, bundler) {
    let files = data.map((a) => {
        let filePath = a.id;
        let filePathArray = filePath.split(path.sep);
        let relativePath = filePathArray.slice(bundler.srcPathArray.length).join(path.posix.sep);

        return fileUtils.navigateFromDirectoryWithRelativePath(bundler.root, relativePath);
    });

    return files;
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

// Replace '</script' with '\u003c/script' (so that it doesn't exit the <script> element)
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

async function handleScriptFile(file, bundler) {
    bundler.log(`Handling script file "${file.getRelativePath()}"...`)

    let code = file.getRawContents();
    code = processCode(code, bundler);

    file.contentOverride = code;
    file.isNecessary = true;
}

async function handleModuleFile(file, bundler) {
    bundler.log(`Handling module file "${file.getRelativePath()}"...`);

    let { code } = await rollupFile(file, bundler);
    code = processCode(code, bundler);

    file.contentOverride = code;
    file.isNecessary = true;
}

exports.processScriptElements = processScriptElements;
exports.handleScriptFile = handleScriptFile;
exports.handleModuleFile = handleModuleFile;