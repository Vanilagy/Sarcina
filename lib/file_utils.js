const path = require('path');
const fs = require('fs-extra');
const copyFileSync = require('fs-copy-file-sync');

const options = require('./options.js');

class FileBase {
    constructor(name = null, parent = null, bundler = null) {
        this.name = name;
        this.parent = parent;
        this.bundler = bundler;
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
        return getAbsoluteFilePath(this.bundler.options.src, this);
    }

    getRelativePath() {
        return getRelativeFilePath(this);
    }
}

class File extends FileBase {
    constructor(name, parent, bundler) {
        super(name, parent, bundler);

        this.contentOverride = null;
        this.bundles = new Set(); // Set the bundles this file is a part of
    }

    getContents() {
        return fs.readFileSync(this.getAbsolutePath()).toString();
    }
}

class Directory extends FileBase {
    constructor(name, parent, bundler) {
        super(name, parent, bundler);

        this.files = [];
    }

    createSubdirectory(name) {
        let newDirectory = new Directory(name, this, this.bundler);
        this.files.push(newDirectory);

        return newDirectory;
    }

    createFile(name) {
        let newFile = new File(name, this, this.bundler);
        this.files.push(newFile);

        return newFile;
    }

    cleanseFiles() {
        for (let file of this.files) {
            if (file === this.bundler.bundleDirectory || this.bundler.options.pathShouldBeKept(file.getRelativePath())) continue;

            if (file.constructor === File) {
                if (this.bundler.options.pathIsIgnored(file.getRelativePath())) file.ignored = true;

                if (isScriptFile(file)) {
                    switch (this.bundler.options.scriptFileAction) {
                        case options.OptionConstants.REMOVE_ALL: {
                            file.ignored = true;
                        }; break;
                        case options.OptionConstants.REMOVE_BUNDLED: {
                            if (file.bundles.size > 0) file.ignored = true;
                        }; break;
                        case options.OptionConstants.KEEP_ALL: {
                            file.ignored = false;
                        }; break;
                    }
                } else if (isCssFile(file)) {
                    switch (this.bundler.options.cssFileAction) {
                        case options.OptionConstants.REMOVE_ALL: {
                            file.ignored = true;
                        }; break;
                        case options.OptionConstants.REMOVE_BUNDLED: {
                            if (file.bundles.size > 0) file.ignored = true;
                        }; break;
                        case options.OptionConstants.KEEP_ALL: {
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
            if (cleanse || this.bundler.options.pathIsIgnored(file.getRelativePath())) file.ignored = true;
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
                this.bundler.log(`Writing file "${file.getRelativePath()}"...`);

                if (file.contentOverride !== null) {
                    fs.writeFileSync(destinationPath, file.contentOverride);
                } else {
                    let sourcePath = file.getAbsolutePath();

                    copyFileSync(sourcePath, destinationPath);
                }
            } else if (file.constructor === Directory) {
                this.bundler.log(`Creating directory "${file.getRelativePath()}"...`);

                fs.mkdirSync(destinationPath);
                file.write(destinationPath);
            }
        }
    }

    getRelativePath() {
        return getRelativeFilePath(this);
    }
}

function getAbsoluteFilePath(absoluteRootPath, file, isPosix = false) {
    let args = [absoluteRootPath, ...file.getFileTreePosition(), file.name];

    if (isPosix) return path.posix.join(...args);
    else return path.join(...args);
}

function getRelativeFilePath(file, isPosix = true) {
    let args = [...file.getFileTreePosition(), file.name];

    if (isPosix) return path.posix.join(...args);
    else return path.join(...args);
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

function isScriptFile(file) {
    return path.extname(file.name) === '.js';
}

function isCssFile(file) {
    return path.extname(file.name) === '.css';
}

function isPHPFile(file) {
    return path.extname(file.name).toLowerCase() === '.php';
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

exports.constructFileTree = constructFileTree;
exports.File = File;
exports.Directory = Directory;
exports.isPHPFile = isPHPFile;
exports.navigateFromDirectoryWithRelativePath = navigateFromDirectoryWithRelativePath;
exports.getPathFromFileAToFileB = getPathFromFileAToFileB;