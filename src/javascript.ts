/**
 * Just enough JavaScript reading to answer two questions about a pasted
 * snippet:
 *
 *   - is it whole, or does it stop in the middle?
 *   - does it use a name that nothing in it defines or imports?
 *
 * This is not a parser and it does not model scope. It is a lexer plus a set of
 * binding patterns, and every judgement call in it is settled the same way:
 * when in doubt, treat the name as *defined*. Over-collecting definitions makes
 * the check miss gaps. Under-collecting them makes it invent gaps. Only one of
 * those two failures is survivable in a tool whose entire value is that it does
 * not say things it cannot support.
 */

/** A name used by a snippet that the snippet never defines. */
export interface UnresolvedName {
  readonly name: string;
  /** 1-based line within the block. */
  readonly line: number;
}

/** A delimiter the snippet opens and never closes, or closes and never opens. */
export interface DelimiterFault {
  readonly kind: 'unclosed' | 'unexpected';
  readonly delimiter: string;
  /** 1-based line within the block. */
  readonly line: number;
}

const KEYWORDS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if',
  'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'of', 'package',
  'private', 'protected', 'public', 'return', 'satisfies', 'static', 'super', 'switch', 'this',
  'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'as', 'from', 'get',
  'set', 'async', 'declare', 'abstract', 'readonly', 'keyof', 'infer', 'asserts', 'is', 'out',
  'accessor', 'using', 'type', 'override', 'unique', 'namespace', 'module',
]);

/**
 * Names a snippet may use without defining them.
 *
 * Runtime globals, the module scope Node gives a CommonJS file, the browser's
 * globals, and the names a test runner injects. A report that pastes a test
 * body is not missing `describe`; the runner supplies it.
 */
const AMBIENT = new Set([
  // language
  'globalThis', 'undefined', 'NaN', 'Infinity', 'arguments', 'eval', 'Object', 'Function', 'Boolean',
  'Symbol', 'Error', 'AggregateError', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'TypeError', 'URIError', 'Number', 'BigInt', 'Math', 'Date', 'String', 'RegExp', 'Array', 'Int8Array',
  'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'WeakRef', 'FinalizationRegistry', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'JSON', 'Atomics',
  'Promise', 'Reflect', 'Proxy', 'Intl', 'WebAssembly', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'unescape',
  // timers and microtasks
  'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate',
  'queueMicrotask', 'structuredClone',
  // node module scope and node globals
  'require', 'module', 'exports', '__dirname', '__filename', 'process', 'console', 'Buffer', 'global',
  'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal', 'Event',
  'EventTarget', 'MessageChannel', 'MessagePort', 'BroadcastChannel', 'performance', 'crypto', 'fetch',
  'Request', 'Response', 'Headers', 'FormData', 'Blob', 'File', 'ReadableStream', 'WritableStream',
  'TransformStream', 'CompressionStream', 'DecompressionStream', 'Deno', 'Bun',
  // browser
  'window', 'document', 'navigator', 'location', 'history', 'screen', 'localStorage', 'sessionStorage',
  'alert', 'confirm', 'prompt', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'XMLHttpRequest', 'WebSocket', 'Worker', 'SharedWorker', 'ServiceWorker',
  'customElements', 'CSS', 'Image', 'Audio', 'Option', 'DOMParser', 'XPathResult', 'Node', 'Element',
  'HTMLElement', 'HTMLInputElement', 'HTMLCanvasElement', 'SVGElement', 'CustomEvent', 'MouseEvent',
  'KeyboardEvent', 'PointerEvent', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'PerformanceObserver', 'IntersectionObserverEntry', 'matchMedia', 'atob', 'btoa', 'reportError',
  // test runners, which inject their own vocabulary
  'describe', 'it', 'test', 'expect', 'suite', 'bench', 'before', 'after', 'beforeEach', 'afterEach',
  'beforeAll', 'afterAll', 'jest', 'vi', 'vitest', 'jasmine', 'cy', 'chai', 'sinon', 'assert',
  'context', 'specify', 'xit', 'xdescribe', 'fit', 'fdescribe', 'todo',
  // fixtures a browser-automation runner injects into a test body
  'page', 'browser', 'browserName', 'playwright', 'request',
  // globals that are neither the language's nor Node's
  'Temporal', 'FileList', 'FileReader', 'DataTransfer', 'Notification', 'Storage', 'Selection',
  'Range', 'NodeList', 'HTMLCollection', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment',
  'name', 'self', 'top', 'parent', 'origin', 'frames', 'closed', 'opener', 'scrollX', 'scrollY',
  'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio', 'onerror',
  // compiler-provided vocabulary a framework injects rather than the file importing it
  '$state', '$derived', '$effect', '$props', '$bindable', '$inspect', '$host', '$env',
]);

/**
 * Families of platform interface names, matched rather than enumerated.
 *
 * The DOM has several hundred of these and any list of them is out of date the
 * week it is written. Matching the shape costs a few real gaps -- a reporter's
 * own `ParseError` will never be reported -- and buys never inventing one.
 */
const AMBIENT_SHAPES: readonly RegExp[] = [
  /^(?:HTML|SVG|CSS|DOM|IDB|RTC|WebGL|Media|Speech|Push|Payment|Service|Audio|Canvas|Image|Font|Gamepad|Screen|Storage|XR)[A-Z]\w*$/,
  /^[A-Z]\w*(?:Element|Event|Error|Observer|Stream|Controller|Signal|List|Node)$/,
];

function isAmbient(name: string): boolean {
  return AMBIENT.has(name) || AMBIENT_SHAPES.some((pattern) => pattern.test(name));
}

/** Type names TypeScript provides; only consulted for a TypeScript block. */
const TYPESCRIPT_AMBIENT = new Set([
  'any', 'unknown', 'never', 'void', 'object', 'string', 'number', 'boolean', 'symbol', 'bigint',
  'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Exclude', 'Extract', 'NonNullable',
  'ReturnType', 'Parameters', 'ConstructorParameters', 'InstanceType', 'ThisType', 'Awaited',
  'Uppercase', 'Lowercase', 'Capitalize', 'Uncapitalize', 'Iterable', 'AsyncIterable', 'Iterator',
  'ArrayLike', 'PromiseLike', 'NodeJS', 'JSX', 'Omit', 'Buffer',
]);

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/**
 * Blanks out every string, template, regular expression and comment, keeping
 * the text the same length so line and column numbers still line up.
 *
 * Everything downstream reads the blanked text, so a name that only appears
 * inside a string or a comment can never be reported as an unresolved
 * reference.
 */
export function blankLiterals(code: string): string {
  // A shebang is not JavaScript, and its path would otherwise read as division
  // followed by a run of identifiers.
  const source = code.replace(/^#![^\n]*/, (line) => ' '.repeat(line.length));
  const out = source.split('');
  const blank = (from: number, to: number): void => {
    for (let at = from; at < to && at < out.length; at += 1) {
      if (out[at] !== '\n') out[at] = ' ';
    }
  };

  let at = 0;
  let previous = '';
  while (at < source.length) {
    const char = source[at];

    if (char === '/' && source[at + 1] === '/') {
      const end = source.indexOf('\n', at);
      blank(at, end === -1 ? source.length : end);
      at = end === -1 ? source.length : end;
      continue;
    }
    if (char === '/' && source[at + 1] === '*') {
      const end = source.indexOf('*/', at + 2);
      blank(at, end === -1 ? source.length : end + 2);
      at = end === -1 ? source.length : end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const end = closingQuote(source, at, char);
      blank(at + 1, end);
      at = end + 1;
      previous = char;
      continue;
    }
    if (char === '`') {
      const end = closingQuote(source, at, '`');
      blank(at + 1, end);
      at = end + 1;
      previous = char;
      continue;
    }
    if (char === '/' && startsRegExp(source, at, previous)) {
      const end = closingRegExp(source, at);
      blank(at + 1, end);
      at = end + 1;
      previous = '/';
      continue;
    }
    if (!/\s/.test(char)) previous = char;
    at += 1;
  }
  return out.join('');
}

function closingQuote(code: string, open: number, quote: string): number {
  let at = open + 1;
  while (at < code.length) {
    const char = code[at];
    if (char === '\\') {
      at += 2;
      continue;
    }
    if (char === quote) return at;
    if (quote !== '`' && char === '\n') return at;
    at += 1;
  }
  return code.length;
}

/**
 * Decides whether a `/` opens a regular expression or divides.
 *
 * The test is the character before it. After a value -- an identifier, a
 * closing bracket, a literal -- a slash divides; anywhere else it opens a
 * pattern. Getting this wrong only ever blanks or fails to blank a short run of
 * text, which is why a lexer's worth of accuracy is enough here.
 */
function startsRegExp(code: string, at: number, previous: string): boolean {
  if (previous === '' ) return true;
  if (/[)\]}]/.test(previous)) return false;
  if (/[A-Za-z0-9_$]/.test(previous)) {
    const before = code.slice(0, at).match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
    if (before === null) return false;
    return ['return', 'typeof', 'case', 'in', 'of', 'instanceof', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await'].includes(before[1]);
  }
  return true;
}

function closingRegExp(code: string, open: number): number {
  let at = open + 1;
  let inClass = false;
  while (at < code.length) {
    const char = code[at];
    if (char === '\\') {
      at += 2;
      continue;
    }
    if (char === '\n') return at;
    if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) return at;
    at += 1;
  }
  return code.length;
}

/** Reports brackets a snippet opens and never closes, or closes unopened. */
export function delimiterFaults(code: string): DelimiterFault[] {
  const blanked = blankLiterals(code);
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: Array<{ char: string; line: number }> = [];
  const faults: DelimiterFault[] = [];
  let line = 1;

  for (const char of blanked) {
    if (char === '\n') {
      line += 1;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      stack.push({ char, line });
      continue;
    }
    const opener = pairs[char];
    if (opener === undefined) continue;
    const top = stack.pop();
    if (top === undefined || top.char !== opener) {
      faults.push({ kind: 'unexpected', delimiter: char, line });
      if (top !== undefined) stack.push(top);
    }
  }
  for (const open of stack) faults.push({ kind: 'unclosed', delimiter: open.char, line: open.line });
  return faults;
}

/**
 * Names the snippet binds, by any means at all.
 *
 * Read the patterns below as an over-approximation on purpose: a `for (x of y)`
 * head contributes `y` as well as `x`, a call whose result is destructured
 * contributes the callee's arguments. Each of those makes the unresolved-name
 * check quieter, never louder.
 */
function boundNames(blanked: string): Set<string> {
  const bound = new Set<string>();
  const take = (text: string | undefined): void => {
    if (text === undefined) return;
    for (const match of text.matchAll(IDENTIFIER)) {
      if (!KEYWORDS.has(match[0])) bound.add(match[0]);
    }
  };

  // `const {a, b: c} = ...`, `let x`, `var x, y`, including for-of/in heads.
  for (const match of blanked.matchAll(/\b(?:const|let|var)\s+([\s\S]*?)(?:=[^=]|;|\n|$)/g)) take(match[1]);
  // `function name(params)`, `function* name(params)`.
  for (const match of blanked.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^()]*)\)/g)) {
    take(match[1]);
    take(match[2]);
  }
  // `class Name`, `class Name extends Base`.
  for (const match of blanked.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) take(match[1]);
  // `catch (err)`.
  for (const match of blanked.matchAll(/\bcatch\s*\(([^()]*)\)/g)) take(match[1]);
  // `x => ...` and `(a, b) => ...`.
  for (const match of blanked.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) take(match[1]);
  for (const match of blanked.matchAll(/\(([^()]*)\)\s*(?::[^=>{;\n]+)?=>/g)) take(match[1]);
  // Every `import` form, including `import type` and namespace imports.
  for (const match of blanked.matchAll(/\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\b/g)) take(match[1]);
  for (const match of blanked.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s*[;\n]/g)) take(match[1]);
  // Class and object method heads: `name(params) {`, but not `if (cond) {`.
  for (const match of blanked.matchAll(/([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*(?::[^{;\n]+)?\{/g)) {
    if (['if', 'while', 'for', 'switch', 'catch', 'with'].includes(match[1])) continue;
    take(match[1]);
    take(match[2]);
  }
  // Declared types are names too, and so is anything a `declare` introduces.
  for (const match of blanked.matchAll(/\b(?:interface|type|enum|namespace|module)\s+([A-Za-z_$][\w$]*)/g)) take(match[1]);
  // A labelled statement, so `outer:` is not read as a use of `outer`.
  for (const match of blanked.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:for|while|do)\b/gm)) take(match[1]);
  // Type parameters, and everything else inside angle brackets.
  for (const match of blanked.matchAll(/<([^<>;{}()]*)>/g)) take(match[1]);
  // A mapped type's key, and a `for (x in y)` head.
  for (const match of blanked.matchAll(/\[\s*([A-Za-z_$][\w$]*)\s+in\b/g)) take(match[1]);
  // A signature's parameters: `read(path: string): Buffer`, with no body.
  for (const match of blanked.matchAll(/([A-Za-z_$][\w$]*)?\s*\(([^()]*)\)\s*:/g)) {
    take(match[1]);
    take(match[2]);
  }
  // A type alias with no object body: `type Bar = $ZodString | Foo;`.
  for (const match of blanked.matchAll(/\btype\s+[A-Za-z_$][\w$]*[^=;{]*=([^;\n]*)/g)) take(match[1]);
  // The whole body of a declared type, whose names are declarations by nature.
  for (const body of declarationBodies(blanked)) take(body);
  return bound;
}

/**
 * The `{ ... }` after `interface X`, `type X =` or `enum X`.
 *
 * Everything inside one is a declaration or a type reference, never a use of a
 * value the snippet was supposed to have created, so the contents are taken
 * wholesale rather than picked apart.
 */
function declarationBodies(blanked: string): string[] {
  const bodies: string[] = [];
  for (const match of blanked.matchAll(/\b(?:interface|type|enum)\s+[A-Za-z_$][\w$]*[^{;\n]*\{/g)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let at = open; at < blanked.length; at += 1) {
      if (blanked[at] === '{') depth += 1;
      else if (blanked[at] === '}') {
        depth -= 1;
        if (depth === 0) {
          bodies.push(blanked.slice(open + 1, at));
          break;
        }
      }
    }
  }
  return bodies;
}

/**
 * Names the snippet calls or dereferences but never binds.
 *
 * Only `name(` and `name.` count as a use. That is far narrower than "every
 * free identifier", and it is narrow on purpose: a bare identifier can be JSX
 * body text, an attribute, a type in a position this lexer did not recognise,
 * or a word in a fragment of somebody's compiled output, and each of those
 * produced a wrong answer when the wider rule was measured against real
 * reports. A name that is *called* or *reached into* is doing work, and if the
 * snippet never produced it, running the snippet cannot work.
 *
 * Skipped as well: anything after a `.`, which is a property rather than a free
 * name; anything next to a `:`, which is an object key, a type annotation or a
 * ternary arm; and anything after `as`, `<` or a type keyword. Every exclusion
 * here can only lose a gap, never invent one.
 */
export function unresolvedNames(code: string, options: { typescript?: boolean } = {}): UnresolvedName[] {
  const blanked = blankLiterals(code);
  const bound = boundNames(blanked);
  const found = new Map<string, number>();

  IDENTIFIER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IDENTIFIER.exec(blanked)) !== null) {
    const name = match[0];
    const at = match.index;
    if (KEYWORDS.has(name) || isAmbient(name) || bound.has(name)) continue;
    if (options.typescript === true && TYPESCRIPT_AMBIENT.has(name)) continue;
    // Called, or reached into. Anything else is not read as a use at all.
    if (!/^\s*[(.]/.test(blanked.slice(at + name.length))) continue;

    const before = blanked.slice(0, at);
    const previous = /(\S)\s*$/.exec(before)?.[1] ?? '';
    if (previous === '.' || previous === ':' || previous === '#' || previous === '<' || previous === '@') continue;
    if (/\?\.\s*$/.test(before)) continue;
    // A word immediately before it that introduces a name rather than uses one.
    const priorWord = /([A-Za-z_$][\w$]*)\s*$/.exec(before)?.[1];
    if (priorWord !== undefined && ['interface', 'type', 'enum', 'namespace', 'module', 'as', 'declare', 'satisfies', 'keyof', 'implements', 'extends', 'is', 'infer', 'label', 'function', 'class', 'const', 'let', 'var', 'import', 'export'].includes(priorWord)) continue;

    const after = blanked.slice(at + name.length);
    // An object key, a type annotation, or a ternary arm.
    if (/^\s*:/.test(after)) continue;
    // An optional property or parameter: `value?: string`.
    if (/^\s*\?\s*:/.test(after)) continue;
    // A hyphenated name -- a JSX `data-*` attribute, or a CSS-ish token.
    if (/^-[A-Za-z]/.test(after)) continue;
    /*
     * A JSX attribute name. `onClick` in `<div onClick={...}>` is a property of
     * an element, not a name the snippet has to have created. What separates it
     * from a plain assignment is what comes before: an assignment starts a
     * statement, so the character before it is a terminator or nothing, while
     * an attribute follows a tag name or a previous attribute's value.
     */
    if (/^\s*=[^=>]/.test(after) && /[A-Za-z0-9_$"'`}\/]/.test(previous)) continue;
    // A shorthand property inside an object literal, e.g. `{ foo, bar }`.
    if (previous === ',' || previous === '{') {
      if (/^\s*[,}]/.test(after)) continue;
    }

    if (!found.has(name)) found.set(name, lineOf(blanked, at));
  }

  return [...found].map(([name, line]) => ({ name, line }));
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let at = 0; at < offset && at < text.length; at += 1) {
    if (text[at] === '\n') line += 1;
  }
  return line;
}

/** Relative specifiers and read file paths a snippet depends on. */
export interface ExternalFile {
  readonly path: string;
  readonly kind: 'import' | 'read';
  /** 1-based line within the block. */
  readonly line: number;
}

const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]+)\1/g;
const FILE_READ = /\b(?:readFileSync|readFile|createReadStream|openSync|open|readdirSync|statSync|loadFile)\s*\(\s*(['"])([^'"]+)\1/g;

/** Files the snippet needs that are not part of the snippet. */
export function externalFiles(code: string): ExternalFile[] {
  const found: ExternalFile[] = [];
  for (const [pattern, kind] of [[RELATIVE_SPECIFIER, 'import'], [FILE_READ, 'read']] as const) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      const path = match[2];
      if (kind === 'read' && !/[./]/.test(path)) continue;
      found.push({ path, kind, line: lineOf(code, match.index) });
    }
  }
  return found;
}
