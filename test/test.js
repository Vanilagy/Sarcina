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
    ignore: ['*.html'],
}).then((result) => {
    console.log(result);
});