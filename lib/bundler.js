const path = require('path');
const fs = require('fs-extra');
const now = require('performance-now');

const fileUtils = require('./file_utils.js');
const util = require('./util.js');
const markup = require('./markup.js');
const options = require('./options.js');

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
const EMPTY_BUNDLE = new Bundle(new fileUtils.File(''), []);

class Bundler {
    constructor(optionsOverride) {
        this.options = new options.Options(optionsOverride);
        this.root = new fileUtils.Directory(null, null, this);
        this.bundleDirectory = this.root.createSubdirectory('bundles');
        this.bundles = [];
        this.srcPathArray = null;

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
    
            return { success: true };
        } catch (e) {
            this.log("ERROR: " + e, true);
    
            return { success: false, error: e }
        }
    }

    createBundle(extension, files, data) {
        files = files.slice(0);
    
        for (let b of this.bundles) {
            if (b.filesMatch(files)) return b;
        }
    
        let bundleFile = this.bundleDirectory.createFile(this.generateNextBundleName() + extension);
        bundleFile.contentOverride = data;
    
        let bundle = new Bundle(bundleFile, files);
        this.bundles.push(bundle);
    
        this.log(`Created bundle "${bundleFile.name}".`);
    
        return bundle;
    }

    generateNextBundleName() {
        if (this.options.randomBundleNames) {
            let index = null
            let name;

            while (index !== -1) {
                name = util.generateRandomHexString();
                index = this.bundles.findIndex((a) => a.file.name.indexOf(name) === 0);
            }
    
            return name;
        }

        return this.bundles.length;
    }

    writeToDist() {
        this.log('Creating "dist" folder...');
        fs.removeSync(this.options.dist);
        fs.mkdirSync(this.options.dist);
    
        this.root.write(this.options.dist);
    }
}

async function processDirectory(directory, bundler) {
    for (let file of directory.files) {
        if (file === bundler.bundleDirectory) continue;

        if (file.constructor === fileUtils.File) {
            let extension = path.extname(file.name).toLowerCase();

            if (markup.MARKUP_EXTENSIONS.includes(extension)) {
                if (!bundler.options.pathIsIgnored(file.getRelativePath())) await markup.processMarkup(file, bundler);
            }
        } else if (file.constructor === fileUtils.Directory) {
            await processDirectory(file, bundler);
        }
    }
}

exports.Bundler = Bundler;
exports.EMPTY_BUNDLE = EMPTY_BUNDLE;