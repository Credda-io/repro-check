### Environment

tidyq 0.8.1, Node.js 22.4.0 on Ubuntu 24.04.

### Steps

```js
const { dedupe } = require('tidyq');

const out = dedupe([1, 1, 2]);
console.log(out);
```

### What happens

It prints `[1, 1, 2]`.
