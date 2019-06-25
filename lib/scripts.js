const path = require('path');
const rollup = require('rollup');
const uglify = require('uglify-es');

const markup = require('./markup.js');
const util = require('./util.js');
const fileUtils = require('./file_utils.js');
const bundler = require('./bundler.js');

async function processScriptElements(obj) {
    obj.bundler.log("Processing script elements...");

    let scriptRegExp = /<script(.|\n)*?<\/script>/gi;
    let match;

    let scriptElements = [];

    while ((match = scriptRegExp.exec(obj.contents)) !== null) {
        let matchString = match[0];
        if (obj.isExcludedIndex(match.index)) continue;

        let openingTag = /<script(.|\n)*?>/i.exec(matchString)[0];
        let src = markup.getHtmlElementAttributeValue(openingTag, 'src');
        let isAsync = markup.htmlElementAttributeIsSet(openingTag, 'async');
        let isDefered = markup.htmlElementAttributeIsSet(openingTag, 'defer');
        let type = markup.getHtmlElementAttributeValue(openingTag, 'type');
        if (type === 'module') isDefered = true; // All modules are defered

        if (isAsync) continue;

        scriptElements.push({
            src,
            isDefered,
            type
        });

        obj.contents = util.stringCutout(obj.contents, match.index, match.index + matchString.length);
        obj.contents = util.removeWhitespaceLine(obj.contents, match.index);
        obj.updateExclusionRanges();

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
        if (util.urlIsAbsolute(element.src)) {
            await addCurrentBundle();

            let element = createScriptElement(element.src, element.isDefered, element.type === 'module');
            finalElements.push(element);
        } else if (element.type === 'module') {
            await addCurrentBundle();

            let file = fileUtils.navigateFromDirectoryWithRelativePath(obj.file.parent, element.src);
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

            let file = fileUtils.navigateFromDirectoryWithRelativePath(obj.file.parent, element.src);
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
        obj.bundler.log("Processing script...");

        if (obj.bundler.options.iifeScript) code = `(function(){\n${code}\n})();`;
        if (obj.bundler.options.minifyScript) code = uglify.minify(code, {}).code;

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
                let relativePath = filePathArray.slice(obj.bundler.srcPathArray.length).join(path.posix.sep);

                return fileUtils.navigateFromDirectoryWithRelativePath(obj.bundler.root, relativePath);
            });

            bundleIsModule = false; // Script is no longer a module since it's been rolled up
        } else {
            code = currentBundleCode;
        }
        code = processCode(code);
        
        let bundle;
        if (obj.bundler.options.injectScript) {
            bundle = bundler.EMPTY_BUNDLE;

            let elementStr = createScriptElement(null, bundleDefered, bundleIsModule, code);
            finalElements.push(elementStr);
        } else {
            bundle = obj.bundler.createBundle('.js', currentBundleFiles, code);
            let pathString = fileUtils.getPathFromFileAToFileB(obj.file, bundle.file);
            
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
    obj.contents = util.stringInsertAt(obj.contents, closingBodyTagIndex, insertString);

    obj.updateExclusionRanges();
}

exports.processScriptElements = processScriptElements;