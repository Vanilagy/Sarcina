const sarcina = require('../lib/index.js');
const path = require('path');

/*
sarcina.bundle({
    cssInsertPosition: sarcina.LOCAL,
    cssFileAction: sarcina.KEEP_NECESSARY,
    missingCssFileTagAction: sarcina.KEEP,
    handledCssFiles: ['yes'],
    scriptInsertPosition: sarcina.LOCAL,
})*/

//return;

sarcina.bundle({
    markupOptionOverride: {
        'about.html': {
            minifyMarkup: false,
            insertPolyfill: true,
            minifyCss: false,
            injectCss: true,
            minifyScript: false,
            transpileScript: false
        }
    },
    src: 'src',
    minifyMarkup: false,
    verbose: true,
    minifyScript: true,
    minifyCss: false,
    bundleCss: false,
    bundleScript: false,
    optimizeCss: false,
    autoprefixCss: false,
    transpileScript: false,
    handleInlineCss: true,
    handleInlineScript: true,
    insertPolyfill: true,
    randomBundleNames: false,
    scriptFileAction: sarcina.KEEP_NECESSARY,
    //ignore: ['*.html', ],
    keep: ['about.html'],
    cssInsertPosition: sarcina.END_OF_HEAD,
    scriptInsertPosition: sarcina.LOCAL,
    missingScriptFileTagAction: sarcina.KEEP,
    missingCssFileTagAction: sarcina.REMOVE,
    handledCssFiles: 'necessary',
    handledScriptFiles: [],
    handledModuleFiles: [],
    individuallyHandledFilesOptionOverride: {
        '**': {
            minifyScript: true,
            optimizeCss: true
        }
    }
}).then((result) => {
    console.log(result);
});