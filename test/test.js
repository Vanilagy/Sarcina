const sarcina = require('../lib/index.js');
const path = require('path');

sarcina.bundle({
    src: 'src',
    minifyHtml: false,
    verbose: false,
    minifyScript: true,
    bundleCss: true,
    bundleScript: true,
    optimizeCss: true,
    transpileScript: true,
    randomBundleNames: false,
    ignore: ['*.html', ],
    //keep: ['plain.html'],
    scriptInsertPosition: sarcina.LOCAL,
    handledCssFiles: [],
    handledScriptFiles: [],
    handledModuleFiles: [],
}).then((result) => {
    console.log(result);
});