const sarcina = require('../lib/index.js');
const path = require('path');

sarcina.bundle({
    src: 'src',
    minifyHtml: true,
    verbose: true,
    minifyScript: true,
    bundleCss: true,
    optimizeCss: true,
    transpileScript: true,
    randomBundleNames: false,
    ignore: [],
    handledCssFiles: [],
    handledScriptFiles: [],
    handledModuleFiles: [],
}).then((result) => {
    console.log(result);
});