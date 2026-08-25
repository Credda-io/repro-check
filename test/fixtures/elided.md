### Environment

crumb 1.9.2 on Node.js 22.3.0, Debian 12.

### Reproduction

```js
const crumb = require('crumb');
const config = crumb.load();

// ... the rest of our setup ...

console.log(crumb.parse('a/b'));
```

### Expected

`['a', 'b']`

### Actual

`['a/b']`
