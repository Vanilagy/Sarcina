const sarcina = require('../lib/index.js');
const path = require('path');

sarcina.bundle({
    src: 'src',
    minifyHtml: false,
    verbose: true,
    minifyScript: true,
    bundleCss: true,
    transpileScript: true,
    randomBundleNames: false,
    scriptFileAction: sarcina.KEEP_NECESSARY,
    ignore: ['*.html'],
    handledCssFiles: 'all',
    handledScriptFiles: [],
    handledModuleFiles: ['index.js'],
}).then((result) => {
    console.log(result);
});