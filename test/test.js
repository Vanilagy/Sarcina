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
    randomBundleNames: false,
    ignore: ['*.html', ],
    //keep: ['plain.html'],
    scriptInsertPosition: sarcina.END_OF_BODY,
    handledCssFiles: [],
    handledScriptFiles: [],
    handledModuleFiles: [],
}).then((result) => {
    console.log(result);
});