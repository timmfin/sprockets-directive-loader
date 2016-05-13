# Sprockets-style directive loader for webpack

Converts [Sprockets/Rails directives](https://github.com/sstephenson/sprockets#the-directive-processor)—things like `//= require <path>`—into modules recognizable by Webpack. Works on JS, CoffeeScript, CSS, and Sass files.

### Caveats

  1. This loader assumes that every JS file you `//= require` is a complete, valid JavaScript file that can run on its own. In Rails, you could concatenate together files that were each not valid JavaScript syntax (for example, three files like this: `function sillySplitFunction() {`, `console.log('in silly function');`, `}  // end silly function`).
  1. Related to \#1, your JS files will no longer be run in the global context. They will wrapped inside functions like Webpack does with all modules. So if you were relying on your top-level JS variables getting set globally (or on the `window`), that will no longer work.
  2. This loader doesn't do automatic extension conversion for you. Sprockets/Rails would allow you to refer to `//= require file.coffee` or `//= require file.js`, but in this loader you'll need to refer to exactly the extension that is on the file system (at the point the loader runs?).

_Note it may be possible to fix some or all of the above, but this is only version `0.x.y` and I'm trying the simplest approach first._

## Usage

[Documentation: Using loaders](http://webpack.github.io/docs/using-loaders.html)

## Examples

``` javascript
{
  // ...

  module: {
    // Needs to be a pre-loader so that it is run before files are converted to JS
    preLoaders: [
      {
        test: /\.js$/,
        loader:  "sprockets-directive-loader"
      }, {
        test: /\.css$/,
        loader: "sprockets-directive-loader"
      }
    ],

    // ...
  }
}
```
