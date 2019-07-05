<html>
    <head>
        <title>Sarcina test!</title>
        <link not-a-stylesheet="true">
        <link rel="stylesheet" href="./css/main.css">
        <link rel="stylesheet" href="./css/about.css">
        <link rel="stylesheet" href="./css/input.css">
        <link rel="stylesheet" href="./css/blaaa.css">

        <!--<style>
            body {
                background: red;
            }
        </style>-->
    </head>
    <body>
        <p>This is a very good website!</p>
        <!-- This is a comment! -->

        <script src="./js/async.js" async></script>
        <script src="./js/index.js" async type="module"></script> <!-- async module script -->

        <?php echo "nothing" ?>
        
        <script defer>
            console.log("I am an inline script!");
        </script>

        hehe1

        <script type="module">
            import './js/vars.js';
            console.log("Oh well, I am an inline module script!");
        </script>
        <script defer>
            console.log("I am an inline script, too?");
        </script>
        <script src="./js/index.js"></script> <!-- module script, but omitting the type="module" -->
        <script src="i point to nothing"></script>
        <script defer>
            console.log("I am an inline script, too?");
        </script>
        <script src="./js/index.js" type="module"></script>

        hehe2

        <script src="./js/main.js"></script>
        <script src="./js/util.js"></script>
    </body>
</html>