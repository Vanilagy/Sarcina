const path = require('path');
const fs = require('fs-extra');
const now = require('performance-now');

const fileUtils = require('./file_utils.js');
const util = require('./util.js');
const markup = require('./markup.js');
const options = require('./options.js');
const style = require('./style.js');
const scripts = require('./scripts.js');

class Bundle {
    constructor(file, files) {
        this.file = file;
        this.files = files;
    }

    getCode() {
        return this.file.contentOverride;
    }

    codesMatches(code) {
        return this.getCode() === code;
    }

    filesMatch(files2) {
        if (this.files.length !== files2.length) return false;

        for (let file of files2) {
            if (!this.files.includes(file)) return false;
        }

        return true;
    }
}

// Represents one bundling process
class Bundler {
    constructor(optionsOverride) {
        this.options = new options.BundlerOptions(optionsOverride);
        this.root = new fileUtils.Directory(null, null, this);
        this.bundleDirectory = this.root.createSubdirectory('bundles');
        this.bundles = [];
        this.srcPathArray = null; // An array describing the path to the src folder

        this.init();
    }

    init() {
        this.options.src = path.resolve(this.options.src);
        this.options.dist = path.resolve(this.options.dist);
        this.srcPathArray = this.options.src.split(path.sep);

        if (this.options.ignoreGit) this.options.ignore.push('*.gitignore', '*.git');
        if (this.options.ignoreDsStore) this.options.ignore.push('*.DS_Store');
    }

    log(text, force = false) {
        if (this.options.verbose || force) console.log('[sarcina] ' + text);
    }

    async run() {
        try {
            let start = now();
            this.log("Starting bundling process...\n\n\tSource directory:\n\t" + this.options.src + '\n\n\tTarget directory:\n\t' + this.options.dist + '\n');
    
            this.log("Constructing file tree...");
            fileUtils.constructFileTree(this.options.src, this.root);

            this.log("Processing files...");
            await processDirectory(this.root, this);

            this.log("Cleaning up...");
            this.root.cleanseFiles();
            if (this.options.removeEmptyDirectories) this.root.cleanseDirectories();

            this.log("Writing files...");
            this.writeToDist();
    
            let elapsed = now() - start;
            this.log("Bundling successful. Took " + (elapsed / 1000).toFixed(3) + " seconds.");
    
            return { success: true, error: null };
        } catch (e) {
            this.log("ERROR", true);
            console.error(e);
    
            return { success: false, error: e }
        }
    }

    getBundleWithMatchingFiles(files) {
        if (files.length === 0) return null; // Have to have at least one file to do a 'proper' match

        for (let b of this.bundles) {
            if (b.filesMatch(files)) return b;
        }

        return null;
    }

    createBundle(extension, files, data, isVirtual = false /* virtual bundles won't be written to disk, but are only used internally */) {
        files = files.slice(0);
    
        // Searches for a bundle with matching code, which is then considered equal
        for (let b of this.bundles) {
            if (b.codesMatches(data)) return b;
        }
    
        let bundleFile = this.bundleDirectory.createFile(this.generateNextBundleName(extension) + extension);
        bundleFile.contentOverride = data;
        bundleFile.ignored = isVirtual;
    
        let bundle = new Bundle(bundleFile, files);
        this.bundles.push(bundle);
    
        this.log(`Created${isVirtual? " virtual": ""} bundle "${bundleFile.name}".`);
    
        return bundle;
    }

    // Returns either a random hex string or an int, depending on option
    generateNextBundleName(extension) {
        if (this.options.randomBundleNames) {
            let index = null
            let name;

            while (index !== -1) {
                name = util.generateRandomHexString();
                index = this.bundles.findIndex((a) => a.file.name.indexOf(name) === 0);
            }
    
            return name;
        }

        return this.countBundlesWithExtension(extension);
    }

    countBundlesWithExtension(extension) {
        let count = 0;

        for (let b of this.bundles) {
            if (path.extname(b.file.name) === extension) count++;
        }

        return count;
    }

    // Writes the dist folder to disk
    writeToDist() {
        this.log('Creating "dist" folder...');
        fs.removeSync(this.options.dist);
        fs.mkdirSync(this.options.dist);
    
        this.root.write(this.options.dist);
    }
}

// Recursively scans the directory for files to process
async function processDirectory(directory, bundler) {
    for (let file of directory.files) {
        if (file === bundler.bundleDirectory) continue;

        if (file.constructor === fileUtils.File) {
            let relativePath = file.getRelativePath();
            if (bundler.options.pathIsIgnored(relativePath)) continue;

            let extension = path.extname(file.name).toLowerCase();

            if (markup.MARKUP_EXTENSIONS.includes(extension)) {
                await markup.processMarkup(file, bundler);
            } else if (fileUtils.isCssFile(file)) {
                if (bundler.options.cssFileShouldBeHandled(file)) {
                    await style.handleCssFile(file, bundler);
                }
            } else if (fileUtils.isScriptFile(file)) {
                let scriptFileHandled = false;

                if (bundler.options.scriptFileShouldBeHandled(file)) {
                    await scripts.handleScriptFile(file, bundler);
                    scriptFileHandled = true;
                }
                if (bundler.options.moduleFileShouldBeHandled(file)) {
                    if (scriptFileHandled) {
                        throw new Error(`Can't process script file "${relativePath}" as module because it has already been processed as a regular script file.`);
                    }

                    await scripts.handleModuleFile(file, bundler);
                };
            } 
        } else if (file.constructor === fileUtils.Directory) {
            await processDirectory(file, bundler);
        }
    }
}

exports.Bundler = Bundler;