const sarcina = require('../lib/index.js');
const path = require('path');

sarcina.bundle({
    src: path.join(__dirname, '../../Coupons/')
}).then((resolve) => {
    console.log(resolve)
});