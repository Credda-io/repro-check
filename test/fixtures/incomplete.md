### Environment

crumb 1.9.2, Node.js 22.3.0 on Windows 11.

### Reproduction

```js
const crumb = require('crumb');

function run(input) {
  const parsed = crumb.parse(input);
  if (parsed.length > 0) {
    console.log(parsed[0]);
```

### Expected

The first crumb is logged.

### Actual

Nothing is logged and the process exits 0.
