const sarcina = require('./lib/index.js');

sarcina.bundle({
    src: 'src2',
    minifyHtml: false,
    verbose: false,
    ignore: ['editor.html', 'someShitInnit.js', 'update_map.php', 'mapbackups'],
}).then((result) => {
    console.log(result);
});