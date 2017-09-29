'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.recursivePatternCapture = recursivePatternCapture;

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _doctrine = require('doctrine');

var _doctrine2 = _interopRequireDefault(_doctrine);

var _debug = require('debug');

var _debug2 = _interopRequireDefault(_debug);

var _parse = require('eslint-module-utils/parse');

var _parse2 = _interopRequireDefault(_parse);

var _resolve = require('eslint-module-utils/resolve');

var _resolve2 = _interopRequireDefault(_resolve);

var _ignore = require('eslint-module-utils/ignore');

var _ignore2 = _interopRequireDefault(_ignore);

var _hash = require('eslint-module-utils/hash');

var _unambiguous = require('eslint-module-utils/unambiguous');

var unambiguous = _interopRequireWildcard(_unambiguous);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const log = (0, _debug2.default)('eslint-plugin-import:ExportMap');

const exportCache = new Map();

class ExportMap {
  constructor(path) {
    this.path = path;
    this.namespace = new Map();
    // todo: restructure to key on path, value is resolver + map of names
    this.reexports = new Map();
    this.dependencies = new Map();
    this.errors = [];
  }

  get hasDefault() {
    return this.get('default') != null;
  } // stronger than this.has

  get size() {
    let size = this.namespace.size + this.reexports.size;
    this.dependencies.forEach(dep => size += dep().size);
    return size;
  }

  /**
   * Note that this does not check explicitly re-exported names for existence
   * in the base namespace, but it will expand all `export * from '...'` exports
   * if not found in the explicit namespace.
   * @param  {string}  name
   * @return {Boolean} true if `name` is exported by this module.
   */
  has(name) {
    if (this.namespace.has(name)) return true;
    if (this.reexports.has(name)) return true;

    // default exports must be explicitly re-exported (#328)
    if (name !== 'default') {
      for (let dep of this.dependencies.values()) {
        let innerMap = dep();

        // todo: report as unresolved?
        if (!innerMap) continue;

        if (innerMap.has(name)) return true;
      }
    }

    return false;
  }

  /**
   * ensure that imported name fully resolves.
   * @param  {[type]}  name [description]
   * @return {Boolean}      [description]
   */
  hasDeep(name) {
    if (this.namespace.has(name)) return { found: true, path: [this] };

    if (this.reexports.has(name)) {
      const reexports = this.reexports.get(name),
            imported = reexports.getImport();

      // if import is ignored, return explicit 'null'
      if (imported == null) return { found: true, path: [this]

        // safeguard against cycles, only if name matches
      };if (imported.path === this.path && reexports.local === name) {
        return { found: false, path: [this] };
      }

      const deep = imported.hasDeep(reexports.local);
      deep.path.unshift(this);

      return deep;
    }

    // default exports must be explicitly re-exported (#328)
    if (name !== 'default') {
      for (let dep of this.dependencies.values()) {
        let innerMap = dep();
        // todo: report as unresolved?
        if (!innerMap) continue;

        // safeguard against cycles
        if (innerMap.path === this.path) continue;

        let innerValue = innerMap.hasDeep(name);
        if (innerValue.found) {
          innerValue.path.unshift(this);
          return innerValue;
        }
      }
    }

    return { found: false, path: [this] };
  }

  get(name) {
    if (this.namespace.has(name)) return this.namespace.get(name);

    if (this.reexports.has(name)) {
      const reexports = this.reexports.get(name),
            imported = reexports.getImport();

      // if import is ignored, return explicit 'null'
      if (imported == null) return null;

      // safeguard against cycles, only if name matches
      if (imported.path === this.path && reexports.local === name) return undefined;

      return imported.get(reexports.local);
    }

    // default exports must be explicitly re-exported (#328)
    if (name !== 'default') {
      for (let dep of this.dependencies.values()) {
        let innerMap = dep();
        // todo: report as unresolved?
        if (!innerMap) continue;

        // safeguard against cycles
        if (innerMap.path === this.path) continue;

        let innerValue = innerMap.get(name);
        if (innerValue !== undefined) return innerValue;
      }
    }

    return undefined;
  }

  forEach(callback, thisArg) {
    this.namespace.forEach((v, n) => callback.call(thisArg, v, n, this));

    this.reexports.forEach((reexports, name) => {
      const reexported = reexports.getImport();
      // can't look up meta for ignored re-exports (#348)
      callback.call(thisArg, reexported && reexported.get(reexports.local), name, this);
    });

    this.dependencies.forEach(dep => {
      const d = dep();
      // CJS / ignored dependencies won't exist (#717)
      if (d == null) return;

      d.forEach((v, n) => n !== 'default' && callback.call(thisArg, v, n, this));
    });
  }

  // todo: keys, values, entries?

  reportErrors(context, declaration) {
    context.report({
      node: declaration.source,
      message: `Parse errors in imported module '${declaration.source.value}': ` + `${this.errors.map(e => `${e.message} (${e.lineNumber}:${e.column})`).join(', ')}`
    });
  }
}

exports.default = ExportMap; /**
                              * parse docs from the first node that has leading comments
                              * @param  {...[type]} nodes [description]
                              * @return {{doc: object}}
                              */

function captureDoc(docStyleParsers) {
  const metadata = {},
        nodes = Array.prototype.slice.call(arguments, 1);

  // 'some' short-circuits on first 'true'
  nodes.some(n => {
    if (!n.leadingComments) return false;

    for (let name in docStyleParsers) {
      const doc = docStyleParsers[name](n.leadingComments);
      if (doc) {
        metadata.doc = doc;
      }
    }

    return true;
  });

  return metadata;
}

const availableDocStyleParsers = {
  jsdoc: captureJsDoc,
  tomdoc: captureTomDoc

  /**
   * parse JSDoc from leading comments
   * @param  {...[type]} comments [description]
   * @return {{doc: object}}
   */
};function captureJsDoc(comments) {
  let doc;

  // capture XSDoc
  comments.forEach(comment => {
    // skip non-block comments
    if (comment.value.slice(0, 4) !== '*\n *') return;
    try {
      doc = _doctrine2.default.parse(comment.value, { unwrap: true });
    } catch (err) {
      /* don't care, for now? maybe add to `errors?` */
    }
  });

  return doc;
}

/**
  * parse TomDoc section from comments
  */
function captureTomDoc(comments) {
  // collect lines up to first paragraph break
  const lines = [];
  for (let i = 0; i < comments.length; i++) {
    const comment = comments[i];
    if (comment.value.match(/^\s*$/)) break;
    lines.push(comment.value.trim());
  }

  // return doctrine-like object
  const statusMatch = lines.join(' ').match(/^(Public|Internal|Deprecated):\s*(.+)/);
  if (statusMatch) {
    return {
      description: statusMatch[2],
      tags: [{
        title: statusMatch[1].toLowerCase(),
        description: statusMatch[2]
      }]
    };
  }
}

ExportMap.get = function (source, context) {
  const path = (0, _resolve2.default)(source, context);
  if (path == null) return null;

  return ExportMap.for(path, context);
};

ExportMap.for = function (path, context) {
  let exportMap;

  const cacheKey = (0, _hash.hashObject)({
    settings: context.settings,
    parserPath: context.parserPath,
    parserOptions: context.parserOptions,
    path
  }).digest('hex');

  exportMap = exportCache.get(cacheKey);

  // return cached ignore
  if (exportMap === null) return null;

  const stats = _fs2.default.statSync(path);
  if (exportMap != null) {
    // date equality check
    if (exportMap.mtime - stats.mtime === 0) {
      return exportMap;
    }
    // future: check content equality?
  }

  // check valid extensions first
  if (!(0, _ignore.hasValidExtension)(path, context)) {
    exportCache.set(cacheKey, null);
    return null;
  }

  const content = _fs2.default.readFileSync(path, { encoding: 'utf8' });

  // check for and cache ignore
  if ((0, _ignore2.default)(path, context) || !unambiguous.test(content)) {
    log('ignored path due to unambiguous regex or ignore settings:', path);
    exportCache.set(cacheKey, null);
    return null;
  }

  exportMap = ExportMap.parse(path, content, context);

  // ambiguous modules return null
  if (exportMap == null) return null;

  exportMap.mtime = stats.mtime;

  exportCache.set(cacheKey, exportMap);
  return exportMap;
};

ExportMap.parse = function (path, content, context) {
  var m = new ExportMap(path);

  try {
    var ast = (0, _parse2.default)(path, content, context);
  } catch (err) {
    log('parse error:', path, err);
    m.errors.push(err);
    return m; // can't continue
  }

  if (!unambiguous.isModule(ast)) return null;

  const docstyle = context.settings && context.settings['import/docstyle'] || ['jsdoc'];
  const docStyleParsers = {};
  docstyle.forEach(style => {
    docStyleParsers[style] = availableDocStyleParsers[style];
  });

  // attempt to collect module doc
  ast.comments.some(c => {
    if (c.type !== 'Block') return false;
    try {
      const doc = _doctrine2.default.parse(c.value, { unwrap: true });
      if (doc.tags.some(t => t.title === 'module')) {
        m.doc = doc;
        return true;
      }
    } catch (err) {/* ignore */}
    return false;
  });

  const namespaces = new Map();

  function remotePath(node) {
    return _resolve2.default.relative(node.source.value, path, context.settings);
  }

  function resolveImport(node) {
    const rp = remotePath(node);
    if (rp == null) return null;
    return ExportMap.for(rp, context);
  }

  function getNamespace(identifier) {
    if (!namespaces.has(identifier.name)) return;

    return function () {
      return resolveImport(namespaces.get(identifier.name));
    };
  }

  function addNamespace(object, identifier) {
    const nsfn = getNamespace(identifier);
    if (nsfn) {
      Object.defineProperty(object, 'namespace', { get: nsfn });
    }

    return object;
  }

  ast.body.forEach(function (n) {

    if (n.type === 'ExportDefaultDeclaration') {
      const exportMeta = captureDoc(docStyleParsers, n);
      if (n.declaration.type === 'Identifier') {
        addNamespace(exportMeta, n.declaration);
      }
      m.namespace.set('default', exportMeta);
      return;
    }

    if (n.type === 'ExportAllDeclaration') {
      let remoteMap = remotePath(n);
      if (remoteMap == null) return;
      m.dependencies.set(remoteMap, () => ExportMap.for(remoteMap, context));
      return;
    }

    // capture namespaces in case of later export
    if (n.type === 'ImportDeclaration') {
      let ns;
      if (n.specifiers.some(s => s.type === 'ImportNamespaceSpecifier' && (ns = s))) {
        namespaces.set(ns.local.name, n);
      }
      return;
    }

    if (n.type === 'ExportNamedDeclaration') {
      // capture declaration
      if (n.declaration != null) {
        switch (n.declaration.type) {
          case 'FunctionDeclaration':
          case 'ClassDeclaration':
          case 'TypeAlias': // flowtype with babel-eslint parser
          case 'InterfaceDeclaration':
          case 'TSEnumDeclaration':
          case 'TSInterfaceDeclaration':
          case 'TSAbstractClassDeclaration':
            m.namespace.set(n.declaration.id.name, captureDoc(docStyleParsers, n));
            break;
          case 'VariableDeclaration':
            n.declaration.declarations.forEach(d => recursivePatternCapture(d.id, id => m.namespace.set(id.name, captureDoc(docStyleParsers, d, n))));
            break;
        }
      }

      n.specifiers.forEach(s => {
        const exportMeta = {};
        let local;

        switch (s.type) {
          case 'ExportDefaultSpecifier':
            if (!n.source) return;
            local = 'default';
            break;
          case 'ExportNamespaceSpecifier':
            m.namespace.set(s.exported.name, Object.defineProperty(exportMeta, 'namespace', {
              get() {
                return resolveImport(n);
              }
            }));
            return;
          case 'ExportSpecifier':
            if (!n.source) {
              m.namespace.set(s.exported.name, addNamespace(exportMeta, s.local));
              return;
            }
          // else falls through
          default:
            local = s.local.name;
            break;
        }

        // todo: JSDoc
        m.reexports.set(s.exported.name, { local, getImport: () => resolveImport(n) });
      });
    }
  });

  return m;
};

/**
 * Traverse a pattern/identifier node, calling 'callback'
 * for each leaf identifier.
 * @param  {node}   pattern
 * @param  {Function} callback
 * @return {void}
 */
function recursivePatternCapture(pattern, callback) {
  switch (pattern.type) {
    case 'Identifier':
      // base case
      callback(pattern);
      break;

    case 'ObjectPattern':
      pattern.properties.forEach(p => {
        recursivePatternCapture(p.value, callback);
      });
      break;

    case 'ArrayPattern':
      pattern.elements.forEach(element => {
        if (element == null) return;
        recursivePatternCapture(element, callback);
      });
      break;
  }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIkV4cG9ydE1hcC5qcyJdLCJuYW1lcyI6WyJyZWN1cnNpdmVQYXR0ZXJuQ2FwdHVyZSIsInVuYW1iaWd1b3VzIiwibG9nIiwiZXhwb3J0Q2FjaGUiLCJNYXAiLCJFeHBvcnRNYXAiLCJjb25zdHJ1Y3RvciIsInBhdGgiLCJuYW1lc3BhY2UiLCJyZWV4cG9ydHMiLCJkZXBlbmRlbmNpZXMiLCJlcnJvcnMiLCJoYXNEZWZhdWx0IiwiZ2V0Iiwic2l6ZSIsImZvckVhY2giLCJkZXAiLCJoYXMiLCJuYW1lIiwidmFsdWVzIiwiaW5uZXJNYXAiLCJoYXNEZWVwIiwiZm91bmQiLCJpbXBvcnRlZCIsImdldEltcG9ydCIsImxvY2FsIiwiZGVlcCIsInVuc2hpZnQiLCJpbm5lclZhbHVlIiwidW5kZWZpbmVkIiwiY2FsbGJhY2siLCJ0aGlzQXJnIiwidiIsIm4iLCJjYWxsIiwicmVleHBvcnRlZCIsImQiLCJyZXBvcnRFcnJvcnMiLCJjb250ZXh0IiwiZGVjbGFyYXRpb24iLCJyZXBvcnQiLCJub2RlIiwic291cmNlIiwibWVzc2FnZSIsInZhbHVlIiwibWFwIiwiZSIsImxpbmVOdW1iZXIiLCJjb2x1bW4iLCJqb2luIiwiY2FwdHVyZURvYyIsImRvY1N0eWxlUGFyc2VycyIsIm1ldGFkYXRhIiwibm9kZXMiLCJBcnJheSIsInByb3RvdHlwZSIsInNsaWNlIiwiYXJndW1lbnRzIiwic29tZSIsImxlYWRpbmdDb21tZW50cyIsImRvYyIsImF2YWlsYWJsZURvY1N0eWxlUGFyc2VycyIsImpzZG9jIiwiY2FwdHVyZUpzRG9jIiwidG9tZG9jIiwiY2FwdHVyZVRvbURvYyIsImNvbW1lbnRzIiwiY29tbWVudCIsInBhcnNlIiwidW53cmFwIiwiZXJyIiwibGluZXMiLCJpIiwibGVuZ3RoIiwibWF0Y2giLCJwdXNoIiwidHJpbSIsInN0YXR1c01hdGNoIiwiZGVzY3JpcHRpb24iLCJ0YWdzIiwidGl0bGUiLCJ0b0xvd2VyQ2FzZSIsImZvciIsImV4cG9ydE1hcCIsImNhY2hlS2V5Iiwic2V0dGluZ3MiLCJwYXJzZXJQYXRoIiwicGFyc2VyT3B0aW9ucyIsImRpZ2VzdCIsInN0YXRzIiwic3RhdFN5bmMiLCJtdGltZSIsInNldCIsImNvbnRlbnQiLCJyZWFkRmlsZVN5bmMiLCJlbmNvZGluZyIsInRlc3QiLCJtIiwiYXN0IiwiaXNNb2R1bGUiLCJkb2NzdHlsZSIsInN0eWxlIiwiYyIsInR5cGUiLCJ0IiwibmFtZXNwYWNlcyIsInJlbW90ZVBhdGgiLCJyZWxhdGl2ZSIsInJlc29sdmVJbXBvcnQiLCJycCIsImdldE5hbWVzcGFjZSIsImlkZW50aWZpZXIiLCJhZGROYW1lc3BhY2UiLCJvYmplY3QiLCJuc2ZuIiwiT2JqZWN0IiwiZGVmaW5lUHJvcGVydHkiLCJib2R5IiwiZXhwb3J0TWV0YSIsInJlbW90ZU1hcCIsIm5zIiwic3BlY2lmaWVycyIsInMiLCJpZCIsImRlY2xhcmF0aW9ucyIsImV4cG9ydGVkIiwicGF0dGVybiIsInByb3BlcnRpZXMiLCJwIiwiZWxlbWVudHMiLCJlbGVtZW50Il0sIm1hcHBpbmdzIjoiOzs7OztRQWdkZ0JBLHVCLEdBQUFBLHVCOztBQWhkaEI7Ozs7QUFFQTs7OztBQUVBOzs7O0FBRUE7Ozs7QUFDQTs7OztBQUNBOzs7O0FBRUE7O0FBQ0E7O0lBQVlDLFc7Ozs7OztBQUVaLE1BQU1DLE1BQU0scUJBQU0sZ0NBQU4sQ0FBWjs7QUFFQSxNQUFNQyxjQUFjLElBQUlDLEdBQUosRUFBcEI7O0FBRWUsTUFBTUMsU0FBTixDQUFnQjtBQUM3QkMsY0FBWUMsSUFBWixFQUFrQjtBQUNoQixTQUFLQSxJQUFMLEdBQVlBLElBQVo7QUFDQSxTQUFLQyxTQUFMLEdBQWlCLElBQUlKLEdBQUosRUFBakI7QUFDQTtBQUNBLFNBQUtLLFNBQUwsR0FBaUIsSUFBSUwsR0FBSixFQUFqQjtBQUNBLFNBQUtNLFlBQUwsR0FBb0IsSUFBSU4sR0FBSixFQUFwQjtBQUNBLFNBQUtPLE1BQUwsR0FBYyxFQUFkO0FBQ0Q7O0FBRUQsTUFBSUMsVUFBSixHQUFpQjtBQUFFLFdB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K0UsVUFBRXhGLFNBQUYsQ0FBWW1GLEdBQVosQ0FBZ0I4QixFQUFFRyxRQUFGLENBQVczRyxJQUEzQixFQUFpQyxFQUFFTyxLQUFGLEVBQVNELFdBQVcsTUFBTW9GLGNBQWMzRSxDQUFkLENBQTFCLEVBQWpDO0FBQ0QsT0EzQkQ7QUE0QkQ7QUFDRixHQTdFRDs7QUErRUEsU0FBT2dFLENBQVA7QUFDRCxDQTlJRDs7QUFpSkE7Ozs7Ozs7QUFPTyxTQUFTakcsdUJBQVQsQ0FBaUM4SCxPQUFqQyxFQUEwQ2hHLFFBQTFDLEVBQW9EO0FBQ3pELFVBQVFnRyxRQUFRdkIsSUFBaEI7QUFDRSxTQUFLLFlBQUw7QUFBbUI7QUFDakJ6RSxlQUFTZ0csT0FBVDtBQUNBOztBQUVGLFNBQUssZUFBTDtBQUNFQSxjQUFRQyxVQUFSLENBQW1CaEgsT0FBbkIsQ0FBMkJpSCxLQUFLO0FBQzlCaEksZ0NBQXdCZ0ksRUFBRXBGLEtBQTFCLEVBQWlDZCxRQUFqQztBQUNELE9BRkQ7QUFHQTs7QUFFRixTQUFLLGNBQUw7QUFDRWdHLGNBQVFHLFFBQVIsQ0FBaUJsSCxPQUFqQixDQUEwQm1ILE9BQUQsSUFBYTtBQUNwQyxZQUFJQSxXQUFXLElBQWYsRUFBcUI7QUFDckJsSSxnQ0FBd0JrSSxPQUF4QixFQUFpQ3BHLFFBQWpDO0FBQ0QsT0FIRDtBQUlBO0FBaEJKO0FBa0JEIiwiZmlsZSI6IkV4cG9ydE1hcC5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBmcyBmcm9tICdmcydcblxuaW1wb3J0IGRvY3RyaW5lIGZyb20gJ2RvY3RyaW5lJ1xuXG5pbXBvcnQgZGVidWcgZnJvbSAnZGVidWcnXG5cbmltcG9ydCBwYXJzZSBmcm9tICdlc2xpbnQtbW9kdWxlLXV0aWxzL3BhcnNlJ1xuaW1wb3J0IHJlc29sdmUgZnJvbSAnZXNsaW50LW1vZHVsZS11dGlscy9yZXNvbHZlJ1xuaW1wb3J0IGlzSWdub3JlZCwgeyBoYXNWYWxpZEV4dGVuc2lvbiB9IGZyb20gJ2VzbGludC1tb2R1bGUtdXRpbHMvaWdub3JlJ1xuXG5pbXBvcnQgeyBoYXNoT2JqZWN0IH0gZnJvbSAnZXNsaW50LW1vZHVsZS11dGlscy9oYXNoJ1xuaW1wb3J0ICogYXMgdW5hbWJpZ3VvdXMgZnJvbSAnZXNsaW50LW1vZHVsZS11dGlscy91bmFtYmlndW91cydcblxuY29uc3QgbG9nID0gZGVidWcoJ2VzbGludC1wbHVnaW4taW1wb3J0OkV4cG9ydE1hcCcpXG5cbmNvbnN0IGV4cG9ydENhY2hlID0gbmV3IE1hcCgpXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEV4cG9ydE1hcCB7XG4gIGNvbnN0cnVjdG9yKHBhdGgpIHtcbiAgICB0aGlzLnBhdGggPSBwYXRoXG4gICAgdGhpcy5uYW1lc3BhY2UgPSBuZXcgTWFwKClcbiAgICAvLyB0b2RvOiByZXN0cnVjdHVyZSB0byBrZXkgb24gcGF0aCwgdmFsdWUgaXMgcmVzb2x2ZXIgKyBtYXAgb2YgbmFtZXNcbiAgICB0aGlzLnJlZXhwb3J0cyA9IG5ldyBNYXAoKVxuICAgIHRoaXMuZGVwZW5kZW5jaWVzID0gbmV3IE1hcCgpXG4gICAgdGhpcy5lcnJvcnMgPSBbXVxuICB9XG5cbiAgZ2V0IGhhc0RlZmF1bHQoKSB7IHJldHVybiB0aGlzLmdldCgnZGVmYXVsdCcpICE9IG51bGwgfSAvLyBzdHJvbmdlciB0aGFuIHRoaXMuaGFzXG5cbiAgZ2V0IHNpemUoKSB7XG4gICAgbGV0IHNpemUgPSB0aGlzLm5hbWVzcGFjZS5zaXplICsgdGhpcy5yZWV4cG9ydHMuc2l6ZVxuICAgIHRoaXMuZGVwZW5kZW5jaWVzLmZvckVhY2goZGVwID0+IHNpemUgKz0gZGVwKCkuc2l6ZSlcbiAgICByZXR1cm4gc2l6ZVxuICB9XG5cbiAgLyoqXG4gICAqIE5vdGUgdGhhdCB0aGlzIGRvZXMgbm90IGNoZWNrIGV4cGxpY2l0bHkgcmUtZXhwb3J0ZWQgbmFtZXMgZm9yIGV4aXN0ZW5jZVxuICAgKiBpbiB0aGUgYmFzZSBuYW1lc3BhY2UsIGJ1dCBpdCB3aWxsIGV4cGFuZCBhbGwgYGV4cG9ydCAqIGZyb20gJy4uLidgIGV4cG9ydHNcbiAgICogaWYgbm90IGZvdW5kIGluIHRoZSBleHBsaWNpdCBuYW1lc3BhY2UuXG4gICAqIEBwYXJhbSAge3N0cmluZ30gIG5hbWVcbiAgICogQHJldHVybiB7Qm9vbGVhbn0gdHJ1ZSBpZiBgbmFtZWAgaXMgZXhwb3J0ZWQgYnkgdGhpcyBtb2R1bGUuXG4gICAqL1xuICBoYXMobmFtZSkge1xuICAgIGlmICh0aGlzLm5hbWVzcGFjZS5oYXMobmFtZSkpIHJldHVybiB0cnVlXG4gICAgaWYgKHRoaXMucmVleHBvcnRzLmhhcyhuYW1lKSkgcmV0dXJuIHRydWVcblxuICAgIC8vIGRlZmF1bHQgZXhwb3J0cyBtdXN0IGJlIGV4cGxpY2l0bHkgcmUtZXhwb3J0ZWQgKCMzMjgpXG4gICAgaWYgKG5hbWUgIT09ICdkZWZhdWx0Jykge1xuICAgICAgZm9yIChsZXQgZGVwIG9mIHRoaXMuZGVwZW5kZW5jaWVzLnZhbHVlcygpKSB7XG4gICAgICAgIGxldCBpbm5lck1hcCA9IGRlcCgpXG5cbiAgICAgICAgLy8gdG9kbzogcmVwb3J0IGFzIHVucmVzb2x2ZWQ/XG4gICAgICAgIGlmICghaW5uZXJNYXApIGNvbnRpbnVlXG5cbiAgICAgICAgaWYgKGlubmVyTWFwLmhhcyhuYW1lKSkgcmV0dXJuIHRydWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBlbnN1cmUgdGhhdCBpbXBvcnRlZCBuYW1lIGZ1bGx5IHJlc29sdmVzLlxuICAgKiBAcGFyYW0gIHtbdHlwZV19ICBuYW1lIFtkZXNjcmlwdGlvbl1cbiAgICogQHJldHVybiB7Qm9vbGVhbn0gICAgICBbZGVzY3JpcHRpb25dXG4gICAqL1xuICBoYXNEZWVwKG5hbWUpIHtcbiAgICBpZiAodGhpcy5uYW1lc3BhY2UuaGFzKG5hbWUpKSByZXR1cm4geyBmb3VuZDogdHJ1ZSwgcGF0aDogW3RoaXNdIH1cblxuICAgIGlmICh0aGlzLnJlZXhwb3J0cy5oYXMobmFtZSkpIHtcbiAgICAgIGNvbnN0IHJlZXhwb3J0cyA9IHRoaXMucmVleHBvcnRzLmdldChuYW1lKVxuICAgICAgICAgICwgaW1wb3J0ZWQgPSByZWV4cG9ydHMuZ2V0SW1wb3J0KClcblxuICAgICAgLy8gaWYgaW1wb3J0IGlzIGlnbm9yZWQsIHJldHVybiBleHBsaWNpdCAnbnVsbCdcbiAgICAgIGlmIChpbXBvcnRlZCA9PSBudWxsKSByZXR1cm4geyBmb3VuZDogdHJ1ZSwgcGF0aDogW3RoaXNdIH1cblxuICAgICAgLy8gc2FmZWd1YXJkIGFnYWluc3QgY3ljbGVzLCBvbmx5IGlmIG5hbWUgbWF0Y2hlc1xuICAgICAgaWYgKGltcG9ydGVkLnBhdGggPT09IHRoaXMucGF0aCAmJiByZWV4cG9ydHMubG9jYWwgPT09IG5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHsgZm91bmQ6IGZhbHNlLCBwYXRoOiBbdGhpc10gfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkZWVwID0gaW1wb3J0ZWQuaGFzRGVlcChyZWV4cG9ydHMubG9jYWwpXG4gICAgICBkZWVwLnBhdGgudW5zaGlmdCh0aGlzKVxuXG4gICAgICByZXR1cm4gZGVlcFxuICAgIH1cblxuXG4gICAgLy8gZGVmYXVsdCBleHBvcnRzIG11c3QgYmUgZXhwbGljaXRseSByZS1leHBvcnRlZCAoIzMyOClcbiAgICBpZiAobmFtZSAhPT0gJ2RlZmF1bHQnKSB7XG4gICAgICBmb3IgKGxldCBkZXAgb2YgdGhpcy5kZXBlbmRlbmNpZXMudmFsdWVzKCkpIHtcbiAgICAgICAgbGV0IGlubmVyTWFwID0gZGVwKClcbiAgICAgICAgLy8gdG9kbzogcmVwb3J0IGFzIHVucmVzb2x2ZWQ/XG4gICAgICAgIGlmICghaW5uZXJNYXApIGNvbnRpbnVlXG5cbiAgICAgICAgLy8gc2FmZWd1YXJkIGFnYWluc3QgY3ljbGVzXG4gICAgICAgIGlmIChpbm5lck1hcC5wYXRoID09PSB0aGlzLnBhdGgpIGNvbnRpbnVlXG5cbiAgICAgICAgbGV0IGlubmVyVmFsdWUgPSBpbm5lck1hcC5oYXNEZWVwKG5hbWUpXG4gICAgICAgIGlmIChpbm5lclZhbHVlLmZvdW5kKSB7XG4gICAgICAgICAgaW5uZXJWYWx1ZS5wYXRoLnVuc2hpZnQodGhpcylcbiAgICAgICAgICByZXR1cm4gaW5uZXJWYWx1ZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgZm91bmQ6IGZhbHNlLCBwYXRoOiBbdGhpc10gfVxuICB9XG5cbiAgZ2V0KG5hbWUpIHtcbiAgICBpZiAodGhpcy5uYW1lc3BhY2UuaGFzKG5hbWUpKSByZXR1cm4gdGhpcy5uYW1lc3BhY2UuZ2V0KG5hbWUpXG5cbiAgICBpZiAodGhpcy5yZWV4cG9ydHMuaGFzKG5hbWUpKSB7XG4gICAgICBjb25zdCByZWV4cG9ydHMgPSB0aGlzLnJlZXhwb3J0cy5nZXQobmFtZSlcbiAgICAgICAgICAsIGltcG9ydGVkID0gcmVleHBvcnRzLmdldEltcG9ydCgpXG5cbiAgICAgIC8vIGlmIGltcG9ydCBpcyBpZ25vcmVkLCByZXR1cm4gZXhwbGljaXQgJ251bGwnXG4gICAgICBpZiAoaW1wb3J0ZWQgPT0gbnVsbCkgcmV0dXJuIG51bGxcblxuICAgICAgLy8gc2FmZWd1YXJkIGFnYWluc3QgY3ljbGVzLCBvbmx5IGlmIG5hbWUgbWF0Y2hlc1xuICAgICAgaWYgKGltcG9ydGVkLnBhdGggPT09IHRoaXMucGF0aCAmJiByZWV4cG9ydHMubG9jYWwgPT09IG5hbWUpIHJldHVybiB1bmRlZmluZWRcblxuICAgICAgcmV0dXJuIGltcG9ydGVkLmdldChyZWV4cG9ydHMubG9jYWwpXG4gICAgfVxuXG4gICAgLy8gZGVmYXVsdCBleHBvcnRzIG11c3QgYmUgZXhwbGljaXRseSByZS1leHBvcnRlZCAoIzMyOClcbiAgICBpZiAobmFtZSAhPT0gJ2RlZmF1bHQnKSB7XG4gICAgICBmb3IgKGxldCBkZXAgb2YgdGhpcy5kZXBlbmRlbmNpZXMudmFsdWVzKCkpIHtcbiAgICAgICAgbGV0IGlubmVyTWFwID0gZGVwKClcbiAgICAgICAgLy8gdG9kbzogcmVwb3J0IGFzIHVucmVzb2x2ZWQ/XG4gICAgICAgIGlmICghaW5uZXJNYXApIGNvbnRpbnVlXG5cbiAgICAgICAgLy8gc2FmZWd1YXJkIGFnYWluc3QgY3ljbGVzXG4gICAgICAgIGlmIChpbm5lck1hcC5wYXRoID09PSB0aGlzLnBhdGgpIGNvbnRpbnVlXG5cbiAgICAgICAgbGV0IGlubmVyVmFsdWUgPSBpbm5lck1hcC5nZXQobmFtZSlcbiAgICAgICAgaWYgKGlubmVyVmFsdWUgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGlubmVyVmFsdWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICBmb3JFYWNoKGNhbGxiYWNrLCB0aGlzQXJnKSB7XG4gICAgdGhpcy5uYW1lc3BhY2UuZm9yRWFjaCgodiwgbikgPT5cbiAgICAgIGNhbGxiYWNrLmNhbGwodGhpc0FyZywgdiwgbiwgdGhpcykpXG5cbiAgICB0aGlzLnJlZXhwb3J0cy5mb3JFYWNoKChyZWV4cG9ydHMsIG5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHJlZXhwb3J0ZWQgPSByZWV4cG9ydHMuZ2V0SW1wb3J0KClcbiAgICAgIC8vIGNhbid0IGxvb2sgdXAgbWV0YSBmb3IgaWdub3JlZCByZS1leHBvcnRzICgjMzQ4KVxuICAgICAgY2FsbGJhY2suY2FsbCh0aGlzQXJnLCByZWV4cG9ydGVkICYmIHJlZXhwb3J0ZWQuZ2V0KHJlZXhwb3J0cy5sb2NhbCksIG5hbWUsIHRoaXMpXG4gICAgfSlcblxuICAgIHRoaXMuZGVwZW5kZW5jaWVzLmZvckVhY2goZGVwID0+IHtcbiAgICAgIGNvbnN0IGQgPSBkZXAoKVxuICAgICAgLy8gQ0pTIC8gaWdub3JlZCBkZXBlbmRlbmNpZXMgd29uJ3QgZXhpc3QgKCM3MTcpXG4gICAgICBpZiAoZCA9PSBudWxsKSByZXR1cm5cblxuICAgICAgZC5mb3JFYWNoKCh2LCBuKSA9PlxuICAgICAgICBuICE9PSAnZGVmYXVsdCcgJiYgY2FsbGJhY2suY2FsbCh0aGlzQXJnLCB2LCBuLCB0aGlzKSlcbiAgICB9KVxuICB9XG5cbiAgLy8gdG9kbzoga2V5cywgdmFsdWVzLCBlbnRyaWVzP1xuXG4gIHJlcG9ydEVycm9ycyhjb250ZXh0LCBkZWNsYXJhdGlvbikge1xuICAgIGNvbnRleHQucmVwb3J0KHtcbiAgICAgIG5vZGU6IGRlY2xhcmF0aW9uLnNvdXJjZSxcbiAgICAgIG1lc3NhZ2U6IGBQYXJzZSBlcnJvcnMgaW4gaW1wb3J0ZWQgbW9kdWxlICcke2RlY2xhcmF0aW9uLnNvdXJjZS52YWx1ZX0nOiBgICtcbiAgICAgICAgICAgICAgICAgIGAke3RoaXMuZXJyb3JzXG4gICAgICAgICAgICAgICAgICAgICAgICAubWFwKGUgPT4gYCR7ZS5tZXNzYWdlfSAoJHtlLmxpbmVOdW1iZXJ9OiR7ZS5jb2x1bW59KWApXG4gICAgICAgICAgICAgICAgICAgICAgICAuam9pbignLCAnKX1gLFxuICAgIH0pXG4gIH1cbn1cblxuLyoqXG4gKiBwYXJzZSBkb2NzIGZyb20gdGhlIGZpcnN0IG5vZGUgdGhhdCBoYXMgbGVhZGluZyBjb21tZW50c1xuICogQHBhcmFtICB7Li4uW3R5cGVdfSBub2RlcyBbZGVzY3JpcHRpb25dXG4gKiBAcmV0dXJuIHt7ZG9jOiBvYmplY3R9fVxuICovXG5mdW5jdGlvbiBjYXB0dXJlRG9jKGRvY1N0eWxlUGFyc2Vycykge1xuICBjb25zdCBtZXRhZGF0YSA9IHt9XG4gICAgICAgLCBub2RlcyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSlcblxuICAvLyAnc29tZScgc2hvcnQtY2lyY3VpdHMgb24gZmlyc3QgJ3RydWUnXG4gIG5vZGVzLnNvbWUobiA9PiB7XG4gICAgaWYgKCFuLmxlYWRpbmdDb21tZW50cykgcmV0dXJuIGZhbHNlXG5cbiAgICBmb3IgKGxldCBuYW1lIGluIGRvY1N0eWxlUGFyc2Vycykge1xuICAgICAgY29uc3QgZG9jID0gZG9jU3R5bGVQYXJzZXJzW25hbWVdKG4ubGVhZGluZ0NvbW1lbnRzKVxuICAgICAgaWYgKGRvYykge1xuICAgICAgICBtZXRhZGF0YS5kb2MgPSBkb2NcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9KVxuXG4gIHJldHVybiBtZXRhZGF0YVxufVxuXG5jb25zdCBhdmFpbGFibGVEb2NTdHlsZVBhcnNlcnMgPSB7XG4gIGpzZG9jOiBjYXB0dXJlSnNEb2MsXG4gIHRvbWRvYzogY2FwdHVyZVRvbURvYyxcbn1cblxuLyoqXG4gKiBwYXJzZSBKU0RvYyBmcm9tIGxlYWRpbmcgY29tbWVudHNcbiAqIEBwYXJhbSAgey4uLlt0eXBlXX0gY29tbWVudHMgW2Rlc2NyaXB0aW9uXVxuICogQHJldHVybiB7e2RvYzogb2JqZWN0fX1cbiAqL1xuZnVuY3Rpb24gY2FwdHVyZUpzRG9jKGNvbW1lbnRzKSB7XG4gIGxldCBkb2NcblxuICAvLyBjYXB0dXJlIFhTRG9jXG4gIGNvbW1lbnRzLmZvckVhY2goY29tbWVudCA9PiB7XG4gICAgLy8gc2tpcCBub24tYmxvY2sgY29tbWVudHNcbiAgICBpZiAoY29tbWVudC52YWx1ZS5zbGljZSgwLCA0KSAhPT0gJypcXG4gKicpIHJldHVyblxuICAgIHRyeSB7XG4gICAgICBkb2MgPSBkb2N0cmluZS5wYXJzZShjb21tZW50LnZhbHVlLCB7IHVud3JhcDogdHJ1ZSB9KVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgLyogZG9uJ3QgY2FyZSwgZm9yIG5vdz8gbWF5YmUgYWRkIHRvIGBlcnJvcnM/YCAqL1xuICAgIH1cbiAgfSlcblxuICByZXR1cm4gZG9jXG59XG5cbi8qKlxuICAqIHBhcnNlIFRvbURvYyBzZWN0aW9uIGZyb20gY29tbWVudHNcbiAgKi9cbmZ1bmN0aW9uIGNhcHR1cmVUb21Eb2MoY29tbWVudHMpIHtcbiAgLy8gY29sbGVjdCBsaW5lcyB1cCB0byBmaXJzdCBwYXJhZ3JhcGggYnJlYWtcbiAgY29uc3QgbGluZXMgPSBbXVxuICBmb3IgKGxldCBpID0gMDsgaSA8IGNvbW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgY29tbWVudCA9IGNvbW1lbnRzW2ldXG4gICAgaWYgKGNvbW1lbnQudmFsdWUubWF0Y2goL15cXHMqJC8pKSBicmVha1xuICAgIGxpbmVzLnB1c2goY29tbWVudC52YWx1ZS50cmltKCkpXG4gIH1cblxuICAvLyByZXR1cm4gZG9jdHJpbmUtbGlrZSBvYmplY3RcbiAgY29uc3Qgc3RhdHVzTWF0Y2ggPSBsaW5lcy5qb2luKCcgJykubWF0Y2goL14oUHVibGljfEludGVybmFsfERlcHJlY2F0ZWQpOlxccyooLispLylcbiAgaWYgKHN0YXR1c01hdGNoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGRlc2NyaXB0aW9uOiBzdGF0dXNNYXRjaFsyXSxcbiAgICAgIHRhZ3M6IFt7XG4gICAgICAgIHRpdGxlOiBzdGF0dXNNYXRjaFsxXS50b0xvd2VyQ2FzZSgpLFxuICAgICAgICBkZXNjcmlwdGlvbjogc3RhdHVzTWF0Y2hbMl0sXG4gICAgICB9XSxcbiAgICB9XG4gIH1cbn1cblxuRXhwb3J0TWFwLmdldCA9IGZ1bmN0aW9uIChzb3VyY2UsIGNvbnRleHQpIHtcbiAgY29uc3QgcGF0aCA9IHJlc29sdmUoc291cmNlLCBjb250ZXh0KVxuICBpZiAocGF0aCA9PSBudWxsKSByZXR1cm4gbnVsbFxuXG4gIHJldHVybiBFeHBvcnRNYXAuZm9yKHBhdGgsIGNvbnRleHQpXG59XG5cbkV4cG9ydE1hcC5mb3IgPSBmdW5jdGlvbiAocGF0aCwgY29udGV4dCkge1xuICBsZXQgZXhwb3J0TWFwXG5cbiAgY29uc3QgY2FjaGVLZXkgPSBoYXNoT2JqZWN0KHtcbiAgICBzZXR0aW5nczogY29udGV4dC5zZXR0aW5ncyxcbiAgICBwYXJzZXJQYXRoOiBjb250ZXh0LnBhcnNlclBhdGgsXG4gICAgcGFyc2VyT3B0aW9uczogY29udGV4dC5wYXJzZXJPcHRpb25zLFxuICAgIHBhdGgsXG4gIH0pLmRpZ2VzdCgnaGV4JylcblxuICBleHBvcnRNYXAgPSBleHBvcnRDYWNoZS5nZXQoY2FjaGVLZXkpXG5cbiAgLy8gcmV0dXJuIGNhY2hlZCBpZ25vcmVcbiAgaWYgKGV4cG9ydE1hcCA9PT0gbnVsbCkgcmV0dXJuIG51bGxcblxuICBjb25zdCBzdGF0cyA9IGZzLnN0YXRTeW5jKHBhdGgpXG4gIGlmIChleHBvcnRNYXAgIT0gbnVsbCkge1xuICAgIC8vIGRhdGUgZXF1YWxpdHkgY2hlY2tcbiAgICBpZiAoZXhwb3J0TWFwLm10aW1lIC0gc3RhdHMubXRpbWUgPT09IDApIHtcbiAgICAgIHJldHVybiBleHBvcnRNYXBcbiAgICB9XG4gICAgLy8gZnV0dXJlOiBjaGVjayBjb250ZW50IGVxdWFsaXR5P1xuICB9XG5cbiAgLy8gY2hlY2sgdmFsaWQgZXh0ZW5zaW9ucyBmaXJzdFxuICBpZiAoIWhhc1ZhbGlkRXh0ZW5zaW9uKHBhdGgsIGNvbnRleHQpKSB7XG4gICAgZXhwb3J0Q2FjaGUuc2V0KGNhY2hlS2V5LCBudWxsKVxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKHBhdGgsIHsgZW5jb2Rpbmc6ICd1dGY4JyB9KVxuXG4gIC8vIGNoZWNrIGZvciBhbmQgY2FjaGUgaWdub3JlXG4gIGlmIChpc0lnbm9yZWQocGF0aCwgY29udGV4dCkgfHwgIXVuYW1iaWd1b3VzLnRlc3QoY29udGVudCkpIHtcbiAgICBsb2coJ2lnbm9yZWQgcGF0aCBkdWUgdG8gdW5hbWJpZ3VvdXMgcmVnZXggb3IgaWdub3JlIHNldHRpbmdzOicsIHBhdGgpXG4gICAgZXhwb3J0Q2FjaGUuc2V0KGNhY2hlS2V5LCBudWxsKVxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBleHBvcnRNYXAgPSBFeHBvcnRNYXAucGFyc2UocGF0aCwgY29udGVudCwgY29udGV4dClcblxuICAvLyBhbWJpZ3VvdXMgbW9kdWxlcyByZXR1cm4gbnVsbFxuICBpZiAoZXhwb3J0TWFwID09IG51bGwpIHJldHVybiBudWxsXG5cbiAgZXhwb3J0TWFwLm10aW1lID0gc3RhdHMubXRpbWVcblxuICBleHBvcnRDYWNoZS5zZXQoY2FjaGVLZXksIGV4cG9ydE1hcClcbiAgcmV0dXJuIGV4cG9ydE1hcFxufVxuXG5cbkV4cG9ydE1hcC5wYXJzZSA9IGZ1bmN0aW9uIChwYXRoLCBjb250ZW50LCBjb250ZXh0KSB7XG4gIHZhciBtID0gbmV3IEV4cG9ydE1hcChwYXRoKVxuXG4gIHRyeSB7XG4gICAgdmFyIGFzdCA9IHBhcnNlKHBhdGgsIGNvbnRlbnQsIGNvbnRleHQpXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZygncGFyc2UgZXJyb3I6JywgcGF0aCwgZXJyKVxuICAgIG0uZXJyb3JzLnB1c2goZXJyKVxuICAgIHJldHVybiBtIC8vIGNhbid0IGNvbnRpbnVlXG4gIH1cblxuICBpZiAoIXVuYW1iaWd1b3VzLmlzTW9kdWxlKGFzdCkpIHJldHVybiBudWxsXG5cbiAgY29uc3QgZG9jc3R5bGUgPSAoY29udGV4dC5zZXR0aW5ncyAmJiBjb250ZXh0LnNldHRpbmdzWydpbXBvcnQvZG9jc3R5bGUnXSkgfHwgWydqc2RvYyddXG4gIGNvbnN0IGRvY1N0eWxlUGFyc2VycyA9IHt9XG4gIGRvY3N0eWxlLmZvckVhY2goc3R5bGUgPT4ge1xuICAgIGRvY1N0eWxlUGFyc2Vyc1tzdHlsZV0gPSBhdmFpbGFibGVEb2NTdHlsZVBhcnNlcnNbc3R5bGVdXG4gIH0pXG5cbiAgLy8gYXR0ZW1wdCB0byBjb2xsZWN0IG1vZHVsZSBkb2NcbiAgYXN0LmNvbW1lbnRzLnNvbWUoYyA9PiB7XG4gICAgaWYgKGMudHlwZSAhPT0gJ0Jsb2NrJykgcmV0dXJuIGZhbHNlXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRvYyA9IGRvY3RyaW5lLnBhcnNlKGMudmFsdWUsIHsgdW53cmFwOiB0cnVlIH0pXG4gICAgICBpZiAoZG9jLnRhZ3Muc29tZSh0ID0+IHQudGl0bGUgPT09ICdtb2R1bGUnKSkge1xuICAgICAgICBtLmRvYyA9IGRvY1xuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikgeyAvKiBpZ25vcmUgKi8gfVxuICAgIHJldHVybiBmYWxzZVxuICB9KVxuXG4gIGNvbnN0IG5hbWVzcGFjZXMgPSBuZXcgTWFwKClcblxuICBmdW5jdGlvbiByZW1vdGVQYXRoKG5vZGUpIHtcbiAgICByZXR1cm4gcmVzb2x2ZS5yZWxhdGl2ZShub2RlLnNvdXJjZS52YWx1ZSwgcGF0aCwgY29udGV4dC5zZXR0aW5ncylcbiAgfVxuXG4gIGZ1bmN0aW9uIHJlc29sdmVJbXBvcnQobm9kZSkge1xuICAgIGNvbnN0IHJwID0gcmVtb3RlUGF0aChub2RlKVxuICAgIGlmIChycCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICAgIHJldHVybiBFeHBvcnRNYXAuZm9yKHJwLCBjb250ZXh0KVxuICB9XG5cbiAgZnVuY3Rpb24gZ2V0TmFtZXNwYWNlKGlkZW50aWZpZXIpIHtcbiAgICBpZiAoIW5hbWVzcGFjZXMuaGFzKGlkZW50aWZpZXIubmFtZSkpIHJldHVyblxuXG4gICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgIHJldHVybiByZXNvbHZlSW1wb3J0KG5hbWVzcGFjZXMuZ2V0KGlkZW50aWZpZXIubmFtZSkpXG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gYWRkTmFtZXNwYWNlKG9iamVjdCwgaWRlbnRpZmllcikge1xuICAgIGNvbnN0IG5zZm4gPSBnZXROYW1lc3BhY2UoaWRlbnRpZmllcilcbiAgICBpZiAobnNmbikge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iamVjdCwgJ25hbWVzcGFjZScsIHsgZ2V0OiBuc2ZuIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIG9iamVjdFxuICB9XG5cblxuICBhc3QuYm9keS5mb3JFYWNoKGZ1bmN0aW9uIChuKSB7XG5cbiAgICBpZiAobi50eXBlID09PSAnRXhwb3J0RGVmYXVsdERlY2xhcmF0aW9uJykge1xuICAgICAgY29uc3QgZXhwb3J0TWV0YSA9IGNhcHR1cmVEb2MoZG9jU3R5bGVQYXJzZXJzLCBuKVxuICAgICAgaWYgKG4uZGVjbGFyYXRpb24udHlwZSA9PT0gJ0lkZW50aWZpZXInKSB7XG4gICAgICAgIGFkZE5hbWVzcGFjZShleHBvcnRNZXRhLCBuLmRlY2xhcmF0aW9uKVxuICAgICAgfVxuICAgICAgbS5uYW1lc3BhY2Uuc2V0KCdkZWZhdWx0JywgZXhwb3J0TWV0YSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChuLnR5cGUgPT09ICdFeHBvcnRBbGxEZWNsYXJhdGlvbicpIHtcbiAgICAgIGxldCByZW1vdGVNYXAgPSByZW1vdGVQYXRoKG4pXG4gICAgICBpZiAocmVtb3RlTWFwID09IG51bGwpIHJldHVyblxuICAgICAgbS5kZXBlbmRlbmNpZXMuc2V0KHJlbW90ZU1hcCwgKCkgPT4gRXhwb3J0TWFwLmZvcihyZW1vdGVNYXAsIGNvbnRleHQpKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgLy8gY2FwdHVyZSBuYW1lc3BhY2VzIGluIGNhc2Ugb2YgbGF0ZXIgZXhwb3J0XG4gICAgaWYgKG4udHlwZSA9PT0gJ0ltcG9ydERlY2xhcmF0aW9uJykge1xuICAgICAgbGV0IG5zXG4gICAgICBpZiAobi5zcGVjaWZpZXJzLnNvbWUocyA9PiBzLnR5cGUgPT09ICdJbXBvcnROYW1lc3BhY2VTcGVjaWZpZXInICYmIChucyA9IHMpKSkge1xuICAgICAgICBuYW1lc3BhY2VzLnNldChucy5sb2NhbC5uYW1lLCBuKVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG4udHlwZSA9PT0gJ0V4cG9ydE5hbWVkRGVjbGFyYXRpb24nKXtcbiAgICAgIC8vIGNhcHR1cmUgZGVjbGFyYXRpb25cbiAgICAgIGlmIChuLmRlY2xhcmF0aW9uICE9IG51bGwpIHtcbiAgICAgICAgc3dpdGNoIChuLmRlY2xhcmF0aW9uLnR5cGUpIHtcbiAgICAgICAgICBjYXNlICdGdW5jdGlvbkRlY2xhcmF0aW9uJzpcbiAgICAgICAgICBjYXNlICdDbGFzc0RlY2xhcmF0aW9uJzpcbiAgICAgICAgICBjYXNlICdUeXBlQWxpYXMnOiAvLyBmbG93dHlwZSB3aXRoIGJhYmVsLWVzbGludCBwYXJzZXJcbiAgICAgICAgICBjYXNlICdJbnRlcmZhY2VEZWNsYXJhdGlvbic6XG4gICAgICAgICAgY2FzZSAnVFNFbnVtRGVjbGFyYXRpb24nOlxuICAgICAgICAgIGNhc2UgJ1RTSW50ZXJmYWNlRGVjbGFyYXRpb24nOlxuICAgICAgICAgIGNhc2UgJ1RTQWJzdHJhY3RDbGFzc0RlY2xhcmF0aW9uJzpcbiAgICAgICAgICAgIG0ubmFtZXNwYWNlLnNldChuLmRlY2xhcmF0aW9uLmlkLm5hbWUsIGNhcHR1cmVEb2MoZG9jU3R5bGVQYXJzZXJzLCBuKSlcbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgY2FzZSAnVmFyaWFibGVEZWNsYXJhdGlvbic6XG4gICAgICAgICAgICBuLmRlY2xhcmF0aW9uLmRlY2xhcmF0aW9ucy5mb3JFYWNoKChkKSA9PlxuICAgICAgICAgICAgICByZWN1cnNpdmVQYXR0ZXJuQ2FwdHVyZShkLmlkLFxuICAgICAgICAgICAgICAgIGlkID0+IG0ubmFtZXNwYWNlLnNldChpZC5uYW1lLCBjYXB0dXJlRG9jKGRvY1N0eWxlUGFyc2VycywgZCwgbikpKSlcbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgbi5zcGVjaWZpZXJzLmZvckVhY2goKHMpID0+IHtcbiAgICAgICAgY29uc3QgZXhwb3J0TWV0YSA9IHt9XG4gICAgICAgIGxldCBsb2NhbFxuXG4gICAgICAgIHN3aXRjaCAocy50eXBlKSB7XG4gICAgICAgICAgY2FzZSAnRXhwb3J0RGVmYXVsdFNwZWNpZmllcic6XG4gICAgICAgICAgICBpZiAoIW4uc291cmNlKSByZXR1cm5cbiAgICAgICAgICAgIGxvY2FsID0gJ2RlZmF1bHQnXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIGNhc2UgJ0V4cG9ydE5hbWVzcGFjZVNwZWNpZmllcic6XG4gICAgICAgICAgICBtLm5hbWVzcGFjZS5zZXQocy5leHBvcnRlZC5uYW1lLCBPYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0TWV0YSwgJ25hbWVzcGFjZScsIHtcbiAgICAgICAgICAgICAgZ2V0KCkgeyByZXR1cm4gcmVzb2x2ZUltcG9ydChuKSB9LFxuICAgICAgICAgICAgfSkpXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICBjYXNlICdFeHBvcnRTcGVjaWZpZXInOlxuICAgICAgICAgICAgaWYgKCFuLnNvdXJjZSkge1xuICAgICAgICAgICAgICBtLm5hbWVzcGFjZS5zZXQocy5leHBvcnRlZC5uYW1lLCBhZGROYW1lc3BhY2UoZXhwb3J0TWV0YSwgcy5sb2NhbCkpXG4gICAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gZWxzZSBmYWxscyB0aHJvdWdoXG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIGxvY2FsID0gcy5sb2NhbC5uYW1lXG4gICAgICAgICAgICBicmVha1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gdG9kbzogSlNEb2NcbiAgICAgICAgbS5yZWV4cG9ydHMuc2V0KHMuZXhwb3J0ZWQubmFtZSwgeyBsb2NhbCwgZ2V0SW1wb3J0OiAoKSA9PiByZXNvbHZlSW1wb3J0KG4pIH0pXG4gICAgICB9KVxuICAgIH1cbiAgfSlcblxuICByZXR1cm4gbVxufVxuXG5cbi8qKlxuICogVHJhdmVyc2UgYSBwYXR0ZXJuL2lkZW50aWZpZXIgbm9kZSwgY2FsbGluZyAnY2FsbGJhY2snXG4gKiBmb3IgZWFjaCBsZWFmIGlkZW50aWZpZXIuXG4gKiBAcGFyYW0gIHtub2RlfSAgIHBhdHRlcm5cbiAqIEBwYXJhbSAge0Z1bmN0aW9ufSBjYWxsYmFja1xuICogQHJldHVybiB7dm9pZH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY3Vyc2l2ZVBhdHRlcm5DYXB0dXJlKHBhdHRlcm4sIGNhbGxiYWNrKSB7XG4gIHN3aXRjaCAocGF0dGVybi50eXBlKSB7XG4gICAgY2FzZSAnSWRlbnRpZmllcic6IC8vIGJhc2UgY2FzZVxuICAgICAgY2FsbGJhY2socGF0dGVybilcbiAgICAgIGJyZWFrXG5cbiAgICBjYXNlICdPYmplY3RQYXR0ZXJuJzpcbiAgICAgIHBhdHRlcm4ucHJvcGVydGllcy5mb3JFYWNoKHAgPT4ge1xuICAgICAgICByZWN1cnNpdmVQYXR0ZXJuQ2FwdHVyZShwLnZhbHVlLCBjYWxsYmFjaylcbiAgICAgIH0pXG4gICAgICBicmVha1xuXG4gICAgY2FzZSAnQXJyYXlQYXR0ZXJuJzpcbiAgICAgIHBhdHRlcm4uZWxlbWVudHMuZm9yRWFjaCgoZWxlbWVudCkgPT4ge1xuICAgICAgICBpZiAoZWxlbWVudCA9PSBudWxsKSByZXR1cm5cbiAgICAgICAgcmVjdXJzaXZlUGF0dGVybkNhcHR1cmUoZWxlbWVudCwgY2FsbGJhY2spXG4gICAgICB9KVxuICAgICAgYnJlYWtcbiAgfVxufVxuIl19