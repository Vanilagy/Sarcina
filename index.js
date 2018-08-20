const fs = require('fs');
const path = require('path');
const url = require('url');
const rimraf = require('rimraf');
const rollup = require('rollup');
const UglifyJS = require('uglify-es');
const HTMLMinify = require('html-minifier').minify;

const MARKUP_FILE_EXTENSIONS = ['.html', '.htm', '.php'];

class Directory {
    constructor(name, depth) {
        this.name = name;
        this.files = [];
        this.depth = depth;
        this.ignore = false;
    }
    
    write(currentDistributionPath, currentSourcePath, relativePath = '') {
        if (!fs.existsSync(currentDistributionPath)) fs.mkdirSync(currentDistributionPath);
        
        for (let i = 0; i < this.files.length; i++) {
            let entry = this.files[i];
            
            if (entry.constructor === File) {
                console.log("Writing file: " + path.posix.join(relativePath, entry.name));
                fs.writeFileSync(path.join(currentDistributionPath, entry.name), entry.content);
            } else if (entry.constructor === CopyFile) {
                let distributionPath = path.join(currentDistributionPath, entry.name);
                let sourcePath = path.join(currentSourcePath, entry.name);
                
                // Copy file
                console.log("Writing file: " + path.posix.join(relativePath, entry.name));
                fs.createReadStream(sourcePath).pipe(fs.createWriteStream(distributionPath));
            } else {
                if (!entry.ignore) entry.write(path.join(currentDistributionPath, entry.name), path.join(currentSourcePath, entry.name), path.posix.join(relativePath, entry.name));
            }
        }
    }
    
    cleanse(currentDistributionPath) {
        let usedEntries = 0;
        
        for (let i = 0; i < this.files.length; i++) {
            let entry = this.files[i];
            
            if (entry.constructor === Directory) {
                usedEntries += entry.cleanse();
            } else {
                usedEntries++;
            }
        }
        
        if (usedEntries === 0) {
            this.ignore = true;
        }
        return usedEntries;
    }
}
class File {
    constructor(name, content) {
        this.name = name;
        this.content = content;
    }
}

class CopyFile {
    constructor(name) {
        this.name = name;
    }
}

class Bundle {
    constructor(name, sourcePathArray, module, code) {
        this.name = name;
        this.sourcePathArray = sourcePathArray;
        this.module = module;
        this.code = code;
    }
    
    equals(otherArr) {
        if (this.sourcePathArray.length !== otherArr.length) {
            return false;
        } else {
            for (let i = 0; i < this.sourcePathArray.length; i++) {
                if (this.sourcePathArray[i] !== otherArr[i]) return false;
            }
            return true;
        }
    }
}

class ScriptElement {
    constructor(src, crossOrigin, defered, module) {
        this.src = src;
        this.crossOrigin = crossOrigin;
        this.defered = defered;
        this.module = module;
    }
}

const optionsDefault = {
    src: path.join(__dirname, '/src'),
    dist: path.join(__dirname + '/dist'),
    bundleScripts: true,
    minifyScript: true,
    iifeScript: true,
    bundleCSS: true,
    minifyCSS: true,
    minifyHTML: true,
    ignoreScriptFiles: true,
    ignoreCSSFiles: true,
    ignoreGit: true,
    ignore: [],
    randomBundleNames: true,
    injectScript: true,
    injectCSS: true
};
let options;
/*
if (process.argv[2]) {
    let arg = process.argv[2];
    let override;
    try {
        override = JSON.parse(arg);
    } catch(e){}
    if (!override) {
        try {
            let fileContents = fs.readFileSync(arg);
            override = JSON.parse(fileContents);
        } catch(e) {}
    }
    
    if (override && typeof override === 'object') {
        for (let key in override) {
            if (options.hasOwnProperty(key)) {
                options[key] = override[key];
            }
        }
    } else {
        console.log("\n=== WARNING: Invalid option override argument (has to be a valid JSON object or a path to a JSON file) - proceeding with default settings");
    }
}*/

let ignoredPaths = [];

let root = new Directory(null, 0);
let bundleDirectory = new Directory('bundles', root.depth+1);
root.files.push(bundleDirectory);
let bundles = [];

let CSSFileId = 0;
let scriptFileId = 0;

async function processMarkup(markup, isPHP, directoryPath, directoryObj, backToRootString) {
    let lowercaseMarkup = markup.toLowerCase();

    let exclusionRanges;
    function updateExclusionRanges() {
        exclusionRanges = [];
        let searchIndex = 0;

        while (true) {
            let startString = null;

            let nextPHPIndex = null;
            if (isPHP) {
                nextPHPIndex = lowercaseMarkup.indexOf('<?php', searchIndex);
                let shortEchoTagIndex = lowercaseMarkup.indexOf('<?=', searchIndex);
                let isShortEchoTag = false;
                if (shortEchoTagIndex !== -1 && (nextPHPIndex === -1 || (shortEchoTagIndex < nextPHPIndex))) {
                    nextPHPIndex = shortEchoTagIndex;
                    isShortEchoTag = true;
                }

                if (nextPHPIndex !== -1) {
                    startString = (isShortEchoTag)? '<?=' : '<?php';
                    let openingStringLength = (isShortEchoTag)? 3 : 5;
                    let followingChar = markup.charAt(nextPHPIndex + openingStringLength);
                    if (!isWhitespace(followingChar)) {
                        searchIndex = nextPHPIndex + openingStringLength;
                        continue;
                    }
                }
            }

            let nextHTMLCommentIndex = markup.indexOf('<!--', searchIndex);
            let exclusionStart = null;
            if (nextPHPIndex !== null && nextPHPIndex !== -1 && nextHTMLCommentIndex !== -1) {
                if (nextHTMLCommentIndex < nextPHPIndex) exclusionStart = nextHTMLCommentIndex; else exclusionStart = nextPHPIndex;
            } else if (nextHTMLCommentIndex !== -1) {
                exclusionStart = nextHTMLCommentIndex;
            }
            if (exclusionStart === nextHTMLCommentIndex) startString = '<!--';

            if (exclusionStart !== null) {
                let endString = '-->';
                if (nextPHPIndex !== null && nextPHPIndex !== -1) endString = '?>';

                let exclusionEnd = markup.indexOf(endString, exclusionStart + startString.length);
                if (exclusionEnd !== -1) {
                    exclusionRanges.push({begin: exclusionStart, end: exclusionEnd + endString.length});
                    searchIndex = exclusionEnd;
                } else {
                    exclusionRanges.push({begin: exclusionStart, end: markup.length});
                    break;
                }
            } else {
                break;
            }
        }
    }
    updateExclusionRanges();

    function isExcluded(index) {
        for (let i = 0; i < exclusionRanges.length; i++) {
            if (exclusionRanges[i].begin < index && exclusionRanges[i].end > index) return true;
        }
        return false;
    }

    function removeWhitespaceLine(index, onRemove) {
        let newlineBefore = markup.lastIndexOf('\n', index-1);
        let newlineAfter = markup.indexOf('\n', index);

        if (newlineBefore !== -1 && newlineAfter !== -1) {
            let onlyWhitespace = true;
            for (let index = newlineBefore; index < newlineAfter; index++) {
                let char = markup[index];
                if (!isWhitespace(char)) {
                    onlyWhitespace = false;
                    break;
                }
            }

            if (onlyWhitespace) {
                markup = markup.slice(0, newlineBefore) + markup.slice(newlineAfter);
                lowercaseMarkup = lowercaseMarkup.slice(0, newlineBefore) + lowercaseMarkup.slice(newlineAfter);

                if (onRemove) onRemove(newlineAfter, newlineBefore);
            }
        }
    }
    
    /* Handles CSS */
    let totalCSS = '';
    let crossOriginCSSSources = [];
    let CSSBundleSourcePaths = [];
    if (options.bundleCSS) {
        let linkRegExp = /<link (.|\n)*?>/g;
        let match;
        while ((match = linkRegExp.exec(lowercaseMarkup)) !== null) {
            let matchString = markup.slice(match.index, match.index + match[0].length);

            if (matchString.indexOf(`rel="stylesheet"`) !== -1 || match[0].indexOf(`rel=\'stylesheet\'`) !== -1) {
                let hrefRegExp = /href=".+?"/;
                let href = hrefRegExp.exec(matchString);
                if (href === null) {
                    srcRegExp = /href='.+?'/; // Single ticks
                    href = hrefRegExp.exec(matchString);
                }

                if (href !== null) {
                    let hrefString = href[0].slice(6, -1);

                    if (url.parse(hrefString).host !== null) {
                        crossOriginCSSSources.push(hrefString);
                    } else {
                        let filePath = path.join(directoryPath, hrefString);

                        let content = fs.readFileSync(filePath).toString();
                        totalCSS += content + '\n';
                        CSSBundleSourcePaths.push(filePath);
                    }

                    markup = markup.slice(0, match.index) + markup.slice(match.index + matchString.length);
                    lowercaseMarkup = lowercaseMarkup.slice(0, match.index) + lowercaseMarkup.slice(match.index + matchString.length);
                    linkRegExp.lastIndex -= match[0].length;

                    removeWhitespaceLine(match.index, (newlineAfter, newlineBefore) => {
                        linkRegExp.lastIndex -= (newlineAfter-newlineBefore);
                    });

                    updateExclusionRanges();
                }
            }
        }
    }
    
    /* Handles scripts */
    let totalScript = '';
    let scriptBundleSourcePaths = [];
    let crossOriginScriptSources = [];
    
    let scriptElements = [];
    
    let scriptIndex = 0;
    while ((scriptIndex = lowercaseMarkup.indexOf('<script ', scriptIndex)) !== -1) {
        if (!isExcluded(scriptIndex)) {
            let thisEndIndex = lowercaseMarkup.indexOf('</script', scriptIndex+7);
            if (thisEndIndex !== -1) {
                let scriptHTML = markup.slice(scriptIndex, thisEndIndex);

                let scriptOpeningBrackets = scriptHTML.slice(1, scriptHTML.indexOf('>'));

                let srcRegExp = /src=".+?"/;
                let src = srcRegExp.exec(scriptOpeningBrackets);
                if (src === null) {
                    srcRegExp = /src='.+?'/; // Single ticks
                    src = srcRegExp.exec(scriptOpeningBrackets);
                }

                if (src !== null) {
                    let asyncRegExp = / async /;
                    let asyncMatch = asyncRegExp.exec(scriptOpeningBrackets);

                    if (asyncMatch === null) {
                        let deferRegExp = / defer/;
                        let deferMatch = deferRegExp.exec(scriptOpeningBrackets);
                        let defered = deferMatch !== null;

                        let moduleRegExp = / type="module"/;
                        let moduleMatch = moduleRegExp.exec(scriptOpeningBrackets);
                        if (!moduleMatch) {
                            moduleRegExp = / type='module'/;
                            moduleMatch = moduleRegExp.exec(scriptOpeningBrackets);
                        }
                        let isModule = moduleMatch !== null;
                        if (isModule) defered = true;

                        let srcString = src[0].slice(5, -1);
                        let isCrossOrigin = url.parse(srcString).host !== null;

                        scriptElements.push(new ScriptElement(srcString, isCrossOrigin, defered, isModule));

                        let actualEndIndex = lowercaseMarkup.indexOf('>', thisEndIndex) + 1;
                        markup = markup.slice(0, scriptIndex) + markup.slice(actualEndIndex);
                        lowercaseMarkup = lowercaseMarkup.slice(0, scriptIndex) + lowercaseMarkup.slice(actualEndIndex);

                        removeWhitespaceLine(scriptIndex, (newlineAfter, newlineBefore) => {
                            scriptIndex -= (newlineAfter-newlineBefore);
                        });

                        updateExclusionRanges();
                    } else {
                        scriptIndex++;
                    }  
                } else {
                    scriptIndex++;
                }
            } else {
                throw new Error('Invalid script element, not closed');
            }
        } else {
            scriptIndex++;
        }
    }

    // Injects CSS files into HTML
    if (options.bundleCSS) {
        let closingHeadTagIndex = lowercaseMarkup.indexOf('</head');
        let linkElementsStr = '';
        for (let i = 0; i < crossOriginCSSSources.length; i++) {
            linkElementsStr += `<link rel="stylesheet" href="${crossOriginCSSSources[i]}">`;
        }
        if (totalCSS.length) {
            let bundle;
            for (let i = 0; i < bundles.length; i++) {
                if (bundles[i].equals(CSSBundleSourcePaths)) {
                    bundle = bundles[i];
                    break;
                }
            }
            if (!bundle) {
                let code = (options.minifyCSS)? minifyCSS(totalCSS) : totalCSS;
                
                fileName = ((options.randomBundleNames)? generateRandomBundleName(16) : CSSFileId++) + ".css";
                bundle = new Bundle(fileName, CSSBundleSourcePaths, null, code);
                bundles.push(bundle);
                
                if (!options.injectCSS) bundleDirectory.files.push(new File(fileName, code));
                
                console.log("Created new bundle: " + fileName);
            }

            if (options.injectCSS) linkElementsStr += `<style>${bundle.code}</style>`;
            else linkElementsStr += `<link rel="stylesheet" href="${path.posix.join(backToRootString, bundleDirectory.name, bundle.name)}">`;
        }
        markup = markup.slice(0, closingHeadTagIndex) + linkElementsStr + markup.slice(closingHeadTagIndex);
        lowercaseMarkup = lowercaseMarkup.slice(0, closingHeadTagIndex) + linkElementsStr + lowercaseMarkup.slice(closingHeadTagIndex);
    }
    
    // Injects script files into HTML
    if (options.bundleScripts) {
        let closingBodyTagIndex = lowercaseMarkup.indexOf('</body');
        let scriptElementsStr = '';
        
        let a = 0;
        for (let i = 0; i < scriptElements.length-a; i++) {
            if (scriptElements[i].defered) {
                scriptElements.push(scriptElements[i]);
                scriptElements.splice(i, 1);
                a++
                i--;
            }
        }
        
        function processCode(code) {
            console.log("Processing script...");
            
            if (options.iifeScript) code = `(function(){\n${code}\n})();`;
            if (options.minifyScript) code = UglifyJS.minify(code, {}).code;
            return code;
        }
        async function addBundle(code, defer, module = false) {
            let bundle;
            for (let i = 0; i < bundles.length; i++) {
                if (bundles[i].module === module && bundles[i].equals(bundleFiles)) {
                    bundle = bundles[i];
                    break;
                }
            }
            if (!bundle) {
                if (module) {
                    let rollupBundle = await rollup.rollup({input: bundleFiles[0]});
                    code = (await rollupBundle.generate({format: 'es'})).code;
                }
                
                code = processCode(code);
                
                fileName = ((options.randomBundleNames)? generateRandomBundleName(16) : scriptFileId++) + ".js";
                bundle = new Bundle(fileName, bundleFiles, module, code);
                bundles.push(bundle);
                
                if (!options.injectScript) bundleDirectory.files.push(new File(fileName, code));
                
                console.log("Created new bundle: " + fileName);
            }
            
            if (!options.injectScript) scriptElementsStr += `<script src="${path.posix.join(backToRootString, bundleDirectory.name, bundle.name)}"`;
            else scriptElementsStr += `<script`;
            if (defer) scriptElementsStr += ` defer`;
            scriptElementsStr += `>`;
            if (options.injectScript) scriptElementsStr += bundle.code;
            scriptElementsStr += `</script>`;
            
            bundleScript = '';
            bundleFiles = [];
        }
        let bundleScript = '',
            bundleFiles = [],
            bundleDefered;
        for (let i = 0; i < scriptElements.length; i++) {
            let elem = scriptElements[i];
            
            if (elem.crossOrigin) {
                if (bundleScript.length) await addBundle(bundleScript, bundleDefered);
                
                scriptElementsStr += `<script src="${elem.src}"`;
                if (elem.module) scriptElementsStr += ` type="module"`;
                if (elem.defered && !elem.module) scriptElementsStr += ` defer`;
                scriptElementsStr += `></script>`;
            } else {
                let filePath = path.join(directoryPath, elem.src);
                
                if (!elem.module) {
                    if (bundleScript.length && bundleDefered !== elem.defered) await addBundle(bundleScript, bundleDefered);
                    
                    bundleScript += fs.readFileSync(filePath) + '\n';
                    bundleFiles.push(filePath);
                    bundleDefered = elem.defered;
                } else {
                    if (bundleScript.length) await addBundle(bundleScript, bundleDefered);
                    
                    bundleFiles = [filePath];
                    await addBundle(null, true, true);
                }
            }
        }
        if (bundleScript.length) await addBundle(bundleScript, bundleDefered);
        
        markup = markup.slice(0, closingBodyTagIndex) + scriptElementsStr + markup.slice(closingBodyTagIndex);
    }
    
    if (options.minifyHTML) markup = HTMLMinify(markup, {
        collapseWhitespace: true,
        conservativeCollapse: true,
        removeComments: true
    });
    return markup;
}

async function processDirectory(directoryPath, directoryObj, relativePath) {
    let backToRootString = getPreviousDirectoryString(directoryObj.depth);
    let files = fs.readdirSync(directoryPath);
    
    outer:
    for (let file of files) {
        if (/DS_Store$/.test(file)) continue;
        
        for (let i = 0; i < ignoredPaths.length; i++) {
            let ignored = false;
            let regExp = ignoredPaths[i], match;
            if ((match = regExp.exec(path.posix.join(relativePath, file))) !== null) {
                if (match.index === 0) ignored = true;
            }
            
            regExp.lastIndex = 0;
            if (ignored) continue outer;
        }
        
        let filePath = path.join(directoryPath, file);
        if (fs.lstatSync(filePath).isDirectory()) {
            if (options.ignoreGit === false || file !== '.git') {
                let newSubdirectory = new Directory(file, directoryObj.depth+1);
                directoryObj.files.push(newSubdirectory);
                await processDirectory(filePath, newSubdirectory, path.posix.join(relativePath, file));
            }
        } else {
            if (options.ignoreGit === false || file !== '.gitignore') {
                let fileIsMarkup = false;
                let fileIsPHP = false;

                for (let extension of MARKUP_FILE_EXTENSIONS) {
                    if (file.indexOf(extension) === file.length - extension.length) {
                        fileIsMarkup = true;
                        if (extension === '.php') fileIsPHP = true;
                        break;
                    }
                }

                if (fileIsMarkup) {
                    console.log("Processing markup: " + path.posix.join(relativePath, file));
                    
                    let markup = fs.readFileSync(path.join(directoryPath, file)).toString();
                    let processedMarkup = await processMarkup(markup, fileIsPHP, directoryPath, directoryObj, backToRootString);

                    directoryObj.files.push(new File(file, processedMarkup));
                } else {
                    let canCopy = true;
                    let isJS = /\.js$/.test(file);
                    let isCSS = /\.css$/.test(file);
                    
                    if (isJS && options.ignoreScriptFiles) canCopy = false;
                    if (isCSS && options.ignoreCSSFiles) canCopy = false;
                    
                    if (canCopy) directoryObj.files.push(new CopyFile(file));
                }
            }
        }
    }
}

function getPreviousDirectoryString(n) {
    let str = '';
    for (let i = 0; i < n; i++) {
        str += '../';
    }
    return str;
}
            
function isWhitespace(char) {
    return char === ' ' || char === '\n' || char === '\r' || char === '\t';
}

function minifyCSS(str) {
    console.log("Processing CSS...");
    
    let commentRegExp = /\/\*.*?\*\//;
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

function generateRandomBundleName(len) {
    while (true) {
        let output = '';
        for (let i = 0; i < len; i++) {
            output += (Math.floor(Math.random() * 16)).toString(16);
        }
        
        for (let i = 0; i < bundles.length; i++) {
            if (bundles[i].name.indexOf(output) === 0) continue;
        }
        return output;
    }
}

function main(optionsOverride) {
    options = {};
    for (let key in optionsDefault) {
        options[key] = optionsDefault[key];
    }
    if (optionsOverride && typeof optionsOverride === 'object') {
        for (let key in optionsOverride) {
            if (options.hasOwnProperty(key)) {
                options[key] = optionsOverride[key];
            }
        }
    }
    
    for (let i = 0; i < options.ignore.length; i++) {
        let path = options.ignore[i];
        path = path.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        path = path.replace(/[*]/g, '.*?');

        ignoredPaths.push(new RegExp(path));
    }
    
    return new Promise(async (resolve, reject) => {
        if (fs.existsSync(options.src)) {
            console.log("\nStarting bundling process...\n====================\nSource: " + options.src + "\nDestination: " + options.dist + "\n");

            await processDirectory(options.src, root, '');

            console.log('');

            if (fs.existsSync(options.dist)) {
                rimraf.sync(options.dist);
            }

            root.cleanse();
            root.write(options.dist, options.src);

            console.log("\nSuccess.");
            
            resolve(true);
        } else {
            reject("No source directory found!");
        }
    });
}

module.exports = {
    bundle: main
};