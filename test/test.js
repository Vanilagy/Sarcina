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
    minifyScript: false,
    minifyCss: false,
    bundleCss: true,
    bundleScript: true,
    optimizeCss: false,
    autoprefixCss: false,
    transpileScript: false,
    handleInlineCss: true,
    handleInlineScript: true,
    insertPolyfill: false,
    randomBundleNames: false,
    //ignore: ['*.html', ],
    keep: ['about.html'],
    cssInsertPosition: sarcina.END_OF_HEAD,
    scriptInsertPosition: sarcina.LOCAL,
    missingScriptFileTagAction: sarcina.KEEP,
    missingCssFileTagAction: sarcina.REMOVE,
    handledCssFiles: [],
    handledScriptFiles: [],
    handledModuleFiles: [],
}).then((result) => {
    console.log(result);
});