var fs = require('fs');
var path = require('path');
var cloneRegexp = require('clone-regexp');
var shellwords = require('shellwords');
var pascalCase = require('pascal-case');
var loaderUtils = require('loader-utils');


// Copied from:
// https://github.com/timmfin/broccoli-sprockets-dependencies/blob/4f20be3924d93577c156b3385fc9f2900af6a595/resolver.coffee#L13-L34

var HEADER_PATTERN = /^(?:\s*((?:\/[*](?:\s*|.+?)*?[*]\/)|(?:\#\#\#\n(?:[\s\S]*)\n\#\#\#)|(?:\/\/.*\n?)+|(?:\#.*\n?)+)*)*/m;
var DIRECTIVE_PATTERN = /^(\W*=)\s*(\w+)\s*(.*?)(\*\/)?$/gm;


function ensureDirDoesntStartWithASlash(dir) {
  // Remove front slash
  if (dir[0] === '/') {
    dir = dir.slice(1);
  }

  return dir;
}


function lookUpDirectoryIn(dirToLookup, rootPathsToCheck) {
  dirToLookup = ensureDirDoesntStartWithASlash(dirToLookup);

  console.log("rootPathsToCheck", rootPathsToCheck);
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


function buildContextRequireString(resolvedDir, extensions, options) {
  options = options || {};

  return [
    'var req = require.context(',
      JSON.stringify(resolvedDir) + ',',
      (options.recursive === true) + ',',  // include subdirectories
      '/.*\.(' + extensions.join('|') + ')$/',
    '); req.keys().forEach(function(key){',
      'req(key);',
    '});'
  ].join('\n');
}


var DirectiveMethods = {
  processRequireDirective: function(webpackLoader, meta, pathToRequire) {
    if (meta.isCss) {
      var importStr;

      // Don't mess with relative or absolute paths. Otherwise prefix `~` to
      // tell webpack to look up the paths as modules
      if (/^(\.|\/)/.test(pathToRequire)) {
        importStr = "@import url(" + pathToRequire + ");"
      } else {
        importStr = "@import url(~" + pathToRequire + ");"
      }

      return importStr;
    } else {
      return "require(" + loaderUtils.stringifyRequest(webpackLoader, pathToRequire) + ");"
    }
  },

  processRequireTreeDirective: function(webpackLoader, meta, dirToRequire) {
    if (meta.isCss) {
      throw new Error("Can't do require_tree for CSS yet");
    } else {
      var resolvedDir,
          locationsToLookIn = [ webpackLoader.options.context];

      if (webpackLoader.options.resolve && webpackLoader.options.resolve.root) {
        Array.prototype.push.apply(locationsToLookIn, webpackLoader.options.resolve.root);
      }

      // If the dirToRequire is a relative path
      if (/^\.?\/\//.test(dirToRequire)) {
        throw new Error("You cannot (yet?) use relative paths in require_tree");
        // CONSIDER, allow??? And ensure that the final resolved path is inside
        // locationsToLookIn ?
      } else {
        resolvedDir = lookUpDirectoryIn(dirToRequire, locationsToLookIn);

        if (!resolvedDir) {
          throw new Error("Couldn't find " + dirToRequire + " in any of " + locationsToLookIn.join(', '))
        }

      }

      return buildContextRequireString(resolvedDir, ['js', 'coffee'], {
        recursive: true
      });
    }
  },

  processRequireDirectoryDirective: function(webpackLoader, meta, dirToRequire) {
    if (meta.isCss) {
      throw new Error("Can't do require_directory for CSS yet");
    } else {
      var resolvedDir,
          locationsToLookIn = [ webpackLoader.options.context];

      if (webpackLoader.options.resolve && webpackLoader.options.resolve.root) {
        Array.prototype.push.apply(locationsToLookIn, webpackLoader.options.resolve.root);
      }

      // If the dirToRequire is a relative path
      if (/^\.?\/\//.test(dirToRequire)) {
        throw new Error("You cannot (yet?) use relative paths in require_directory");
        // CONSIDER, allow??? And ensure that the final resolved path is inside
        // locationsToLookIn ?
      } else {
        resolvedDir = lookUpDirectoryIn(dirToRequire, locationsToLookIn);

        if (!resolvedDir) {
          throw new Error("Couldn't find " + dirToRequire + " in any of " + locationsToLookIn.join(', '))
        }

      }

      return buildContextRequireString(resolvedDir, ['js', 'coffee'], {
        recursive: false
      });
    }
  }
}


function extractHeader(content, customHeaderPattern) {
  var headerPattern = cloneRegexp(customHeaderPattern || HEADER_PATTERN);

  // Must be at the very beginning of the file
  if ((match = headerPattern.exec(content)) && match && match.index === 0) {
    return match[0]
  }
}

function processDependenciesInContent(webpackLoader, content) {
  webpackLoader.cacheable(true);

  var meta = {
    isCss: /\.(css|scss|sass)$/i.test(webpackLoader.resourcePath)
  };

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
      var newModifiedHeaderLine = DirectiveMethods[directiveFunc].apply(this, [webpackLoader, meta].concat(directiveArgs));
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
