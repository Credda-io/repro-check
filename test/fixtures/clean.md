### Version

shellwords-lite 3.2.1, Node.js 22.11.0 on macOS 14.6 (arm64), installed with npm.

### Steps to reproduce

```js
const { parse } = require('shellwords-lite');

const argv = parse('deploy --tag "release 2"');
console.log(argv); //=> [ 'deploy', '--tag', 'release', '2' ]
```

### Expected behaviour

`parse` should keep a double-quoted run together, so the last element is the
single string `release 2` and the array has three elements.

### Actual behaviour

The quoted run is split on the space inside it, producing four elements instead
of three. Nothing throws; the returned array is simply wrong.
