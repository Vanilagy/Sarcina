const sarcina = require('../lib/index.js');
const path = require('path');

sarcina.bundle({
    src: 'src',
    minifyHtml: false,
    verbose: false,
    minifyScript: true,
    bundleCss: true,
    transpileScript: true,
    randomBundleNames: false,
    ignore: [''],
}).then((result) => {
    console.log(result);
});