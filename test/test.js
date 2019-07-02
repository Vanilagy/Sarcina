const sarcina = require('../lib/index.js');
const path = require('path');

//return;

sarcina.bundle({
    src: 'src',
    minifyHtml: false,
    verbose: false,
    minifyScript: true,
    bundleCss: true,
    bundleScript: false,
    optimizeCss: true,
    autoprefixCss: true,
    transpileScript: true,
    randomBundleNames: false,
    //ignore: ['*.html', ],
    //keep: ['plain.html'],
    scriptInsertPosition: sarcina.LOCAL,
    handledCssFiles: [],
    handledScriptFiles: [],
    handledModuleFiles: [],
}).then((result) => {
    console.log(result);
});