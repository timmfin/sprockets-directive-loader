var fs = require('fs');
var path = require('path');
var glob = require('glob');
var cloneRegexp = require('clone-regexp');
var shellwords = require('shellwords');
var pascalCase = require('pascal-case');
var loaderUtils = require('loader-utils');
var escapeRegexp = require('escape-string-regexp');

var utils = require('./utils');
var extractHeader = utils.extractHeader;
var DIRECTIVE_PATTERN = utils.DIRECTIVE_PATTERN;

// Gross that it is hardcoded, but webpack doesn't really have the notion
// of mimetypes or all the extensions that _can_ compile down to JS/CSS.
// Likely should make this configurable?
var JS_EXTENSIONS = [
  'js',
  'coffee'
];

var CSS_EXTENSIONS = [
  'css',
  'scss',
  'sass'
];

var IS_CSS_REGEX = new RegExp('\.(' + CSS_EXTENSIONS.map(escapeRegexp).join('|') + ')$', 'i');

var CSS_GLOB = "*.{" + CSS_EXTENSIONS.map(escapeRegexp).join(',') + "}"
var CSS_RECURSIVE_GLOB = "**/" + CSS_GLOB;

function isFromCSSFile(webpackLoader) {
  return IS_CSS_REGEX.test(webpackLoader.resourcePath);
}


function ensureDirDoesntStartWithASlash(dir) {
  // Remove front slash
  if (dir[0] === '/') {
    dir = dir.slice(1);
  }

  return dir;
}


function lookUpDirectoryIn(dirToLookup, rootPathsToCheck) {
  dirToLookup = ensureDirDoesntStartWithASlash(dirToLookup);

  for (var i = 0; i < rootPathsToCheck.length; i++) {
    var fullPathToCheck = path.join(rootPathsToCheck[i], dirToLookup);

    try {
      // TODO, make async
      var stats = fs.statSync(fullPathToCheck);

      if (stats.isDirectory()) {
        return fullPathToCheck;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  return;
}


function buildContextRequireString(resolvedDir, dirToRequire, extensions, options) {
  options = options || {};
  var isRecursive = options.recursive === true;

  return [
    '// All ' + (isRecursive ? 'recursive ' : '') + extensions.join(', ') + ' files in ' + dirToRequire,
    'var req = require.context(',
      JSON.stringify(resolvedDir) + ',',
      isRecursive + ',',  // include subdirectories
      '/.*\.(' + extensions.join('|') + ')$/',
    '); req.keys().forEach(function(key){',
      'req(key);',
    '});'
  ].join('\n');
}

function cssRequireString(pathToRequire) {
  var importStr;

  // Don't mess with relative or absolute paths. Otherwise prefix `~` to
  // tell webpack to look up the paths as modules
  if (/^(\.|\/)/.test(pathToRequire)) {
    importStr = "@import url(" + pathToRequire + ");"
  } else {
    importStr = "@import url(~" + pathToRequire + ");"
  }

  return importStr;
}


var DirectiveMethods = {
  processRequireDirective: function(webpackLoader, pathToRequire) {
    if (isFromCSSFile(webpackLoader)) {
      return cssRequireString(pathToRequire);
    } else {
      return "require(" + loaderUtils.stringifyRequest(webpackLoader, pathToRequire) + ");"
    }
  },

  _processDirectoryHelper: function(directiveName, isRecursive, webpackLoader, dirToRequire) {
    var resolvedDir,
        locationsToLookIn = [ webpackLoader.options.context];

    if (webpackLoader.options.resolve && webpackLoader.options.resolve.root) {
      Array.prototype.push.apply(locationsToLookIn, webpackLoader.options.resolve.root);
    }

    // If the dirToRequire is a relative path
    if (/^\.?\/\//.test(dirToRequire)) {
      throw new Error("You cannot (yet?) use relative paths in " + directiveName);
      // CONSIDER, allow??? And ensure that the final resolved path is inside
      // locationsToLookIn ?
    } else {
      resolvedDir = lookUpDirectoryIn(dirToRequire, locationsToLookIn);

      if (!resolvedDir) {
        throw new Error("Couldn't find " + dirToRequire + " in any of " + locationsToLookIn.join(', '))
      }

    }

    if (isFromCSSFile(webpackLoader)) {
      var allCSSFiles = glob.sync(isRecursive ? CSS_RECURSIVE_GLOB : CSS_GLOB, {
        cwd: resolvedDir
      }).sort();

      // Get rid of "partials" (files that start with `_`)
      allCSSFiles = allCSSFiles.filter(function(filepath) {
        return path.basename(filepath)[0] != '_';
      });

      // Prefix each file with the original directory path
      allCSSFiles = allCSSFiles.map(function(filepath) {
        return path.join(dirToRequire, filepath);
      })

      return allCSSFiles.map(cssRequireString).join('\n');
    } else {
      // TODO, since we need to glob for CSS, should we just do that here too?
      // (instead of the fancy WebPack require string?)
      return buildContextRequireString(resolvedDir, dirToRequire, JS_EXTENSIONS, {
        recursive: isRecursive
      });
    }

  },

  processRequireTreeDirective: function(webpackLoader, dirToRequire) {
    return DirectiveMethods._processDirectoryHelper.call(this, 'require_tree', true, webpackLoader, dirToRequire);
  },

  processRequireDirectoryDirective: function(webpackLoader, dirToRequire) {
    return DirectiveMethods._processDirectoryHelper.call(this, 'require_directory', false, webpackLoader, dirToRequire);
  }
}


function processDependenciesInContent(webpackLoader, content) {
  webpackLoader.cacheable(true);

  // Extract out all the directives from the header (directives can only appear
  // at the top of the file)
  var header = extractHeader(content);

  // clone regex for safety
  var directivePattern = cloneRegexp(DIRECTIVE_PATTERN);

  var modifiedHeaderLines = [];

  while (match = directivePattern.exec(header)) {
    var preDirective  = match[1];
    var directive     = match[2];
    var directiveArgs = shellwords.split(match[3]);

    var directiveFunc = "process" + pascalCase(directive) + "Directive";

    if (DirectiveMethods[directiveFunc]) {
      var newModifiedHeaderLine = DirectiveMethods[directiveFunc].apply(this, [webpackLoader].concat(directiveArgs));
      if (newModifiedHeaderLine) {
        modifiedHeaderLines.push(newModifiedHeaderLine);
      }
    } else {
      console.warn("Potentially unknown directive `" + preDirective.trim() + " " + directive + "` ? (found in " + resourcePath + ")");
    }
  }

  if (modifiedHeaderLines.length > 0) {
    content = content.replace(
      header,
      '/* Start webpack directive-loader modifications */\n' +
      modifiedHeaderLines.join('\n') + '\n' +
      '/* End webpack directive-loader modifications */\n\n'
    );
  }

  return content;
}



module.exports = function(source) {
  var modifiedSource = processDependenciesInContent(this, source)
  return modifiedSource;
};
