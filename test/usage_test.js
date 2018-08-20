const sarcina = require('../index.js');
const path = require('path');

sarcina.bundle({
    src: path.join(__dirname, '../src/')
}).then((resolve) => {
    console.log(resolve)
});