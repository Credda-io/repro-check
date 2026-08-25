### Environment

parseur 2.4.0 on Node.js 20.11.1, Ubuntu 22.04.

### Reproduction

```js
const { load } = require('parseur');

const settings = parseConfig(load('./app.conf'));
console.log(settings.retries);
```

### Expected

`retries` should be `3`, the value in the file.

### Actual

It prints `undefined` every time.
