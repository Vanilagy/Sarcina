const sarcina = require('../lib/index.js');
const path = require('path');

sarcina.bundle({
    src: 'src',
    minifyHtml: false,
    verbose: true,
    minifyScript: true,
    bundleCss: false,
    bundleScript: false,
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