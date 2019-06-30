<html>
    <head>
        <title>Sarcina test!</title>
        <link rel="stylesheet" href="./css/main.css">
        <link rel="stylesheet" href="./css/about.css">
        <link rel="stylesheet" href="./css/input.css">
        <link rel="stylesheet" href="./css/blaaa.css">

        <style>
            body {
                background: red;
            }
        </style>
    </head>
    <body>
        <p>This is a very good website!</p>
        <!-- This is a comment! -->

        <script src="./js/async.js" async></script>

        <?php echo "nothing" ?>
        
        <script defer>
            console.log("I am an inline script!");
        </script>

        hehe
        
        <script defer>
            console.log("I am an inline script, too?");
        </script>
        <script src="./js/index.js" type="module"></script>
        <script defer>
            console.log("I am an inline script, too?");
        </script>
        <script src="./js/index.js" type="module"></script>

        hehe

        <script src="./js/main.js"></script>
        <script src="./js/util.js"></script>
    </body>
</html>