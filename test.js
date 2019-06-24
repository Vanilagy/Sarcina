const sarcina = require('./lib/index.js');

sarcina.bundle({
    src: 'src2',
    minifyHtml: false,
    verbose: true,
    ignore: ['editor.html', 'someShitInnit.js', 'update_map.php', 'mapbackups'],
});