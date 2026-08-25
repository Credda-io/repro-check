### Environment

yamlish 4.1.0, Node.js 22.4.0 on Alpine Linux 3.20.

### Reproduction

```js
const { readFileSync } = require('node:fs');
const { parse } = require('yamlish');

const text = readFileSync('deploy.yaml', 'utf8');
console.log(parse(text).stages.length);
```

### Expected

`2`, one stage per entry.

### Actual

`1`. The second stage is dropped.
