const sarcina = require('../lib/index.js');
const path = require('path');

//return;

sarcina.bundle({
    src: 'src',
    minifyHtml: false,
    verbose: false,
    minifyScript: false,
    bundleCss: false,
    bundleScript: true,
    optimizeCss: true,
    autoprefixCss: true,
    transpileScript: false,
    handleInlineScript: true,
    randomBundleNames: false,
    ignore: ['*.html', ],
    //keep: ['plain.html'],
    scriptInsertPosition: sarcina.LOCAL,
    missingScriptFileTagAction: sarcina.KEEP,
    handledCssFiles: [],
    handledScriptFiles: [],
    handledModuleFiles: [],
}).then((result) => {
    console.log(result);
});