# sarcina

**This boy is not yet finished. But hey, at least it's not in alpha stage no mo', UwU ^^. Only took like, what, a year? Yes. So, for now:**

## What is it? And why?
Sarcina is as super-simple, zero-configuration and fast bundling tool made to get your web projects ready for production. It is meant to be a works-out-of-the-box alternative to traditional bundlers like Webpack, whose complicated configuration is often overkill for most projects. That said, Sarcina purposefully targets only *regular vanilla* non-framework web projects - in other words, projects that don't **need** to be built while working on them. I believe in-development build tools do nothing but slow down the developer, while simultaneously increasing project complexity. Sarcina is therefore intended to be run only when bundling a project for deployment, not constantly during development.

## What does it do?
At its core, Sarcina creates a production distribution folder by processing every markup file in a folder, parsing it for CSS and JavaScript elements, creating bundles using those files and re-inserting links to the bundles back into the markup. During this process, your HTML can be minified, your CSS minified and autoprefixed, and your JavaScript minified and transpiled.

The resulting folder has considerably less files and complexity, and is often much smaller in total size. Less and smaller files to load by the browser can improve the user experience drastically.

## An example
**Consider this source folder:**
```
src
│   index.html
│   about.html  
└───css
|   │   base.css
|   │   about.css
└───js
    │   main.js
    │   util.js
    │   about.js
    │   constants.js
```

```html
<!-- index.html -->
<html>
    <head>
        <title>Main Page</title>
        <link rel="stylesheet" href="css/base.css">
    </head>
    <body>
        <h1>Welcome!</h1>
        <script src="js/util.js"></script>
        <script src="js/main.js"></script>
    </body>
</html>

<!-- about.html -->
<html>
    <head>
        <title>About Page</title>
        <link rel="stylesheet" href="css/base.css">
        <link rel="stylesheet" href="css/about.css">
    </head>
    <body>
        <h1>About</h1>
        <p>This is a really dope page.</p>
        <script src="js/util.js"></script>
        <script src="js/main.js"></script>
        <script src="js/about.js" type="module"></script>
    </body>
</html>
```

```css
/* base.css */
body {
    background: blue;
    display: none;
}
h1 {
    font-size: 22px;
}

/* about.css */
p {
    color: white;
}
```

```javascript
// util.js
function showElement(element) {
    element.style.display = 'block';
}

// main.js
window.addEventListener('load', () => {
    console.log("Page loaded!");
    showElement(document.querySelector('body'));
});

// about.js
import { GOLDEN_RATIO } from './constants.js';
console.log("Oh, by the way, the golden ratio is " + GOLDEN_RATIO);

// constants.js
export const PI = Math.PI;
export const GOLDEN_RATIO = 1.61803398875;
```

**After running Sarcina on this source folder, we get the following distribution folder:**
```
dist
│   index.html
│   about.html  
└───bundles
    │   0.css
    │   1.css
    │   0.js
    │   1.js
```

```html
<!-- index.html -->
<html>
    <head>
        <title>Main Page</title>
        <link rel="stylesheet" href="bundles/0.css">
    </head>
    <body>
        <h1>Welcome!</h1>
        <script src="bundles/0.js"></script>
    </body>
</html>

<!-- about.html -->
<html>
    <head>
        <title>About Page</title>
        <link rel="stylesheet" href="bundles/1.css">
    </head>
    <body>
        <h1>About</h1>
        <p>This is a really dope page.</p>
        <script src="bundles/0.js"></script>
        <script src="bundles/1.js"></script>
    </body>
</html>
```

```css
/* 0.css */
body{background: blue;display: none;}h1{font-size: 22px;}

/* 1.css */
body{background: blue;display: none;}h1{font-size: 22px;}p{color:white;}
```

```javascript
// 0.js
function showElement(element){element.style.display='block'};window.addEventListener('load',function(){console.log("Page loaded!"),showElement(document.querySelector('body'))});

// 1.js
console.log("Oh, by the way, the golden ratio is "+1.61803398875);
```

Sarcina took all the source files, minified and bundled them, and re-inserted them into the HTML (which was left unminified for demonstration purposes). More specifically, `js/util.js` and `js/main.js` were bundled together into `bundles/0.js`,while the ES6 Modules in `js/about.js` were automatically resolved by Sarcina and bundled into `bundles/1.js`. In `index.html`, `css/base.css` was bundled on its own, while in `about.html`, it was bundled with `css/about.css`.