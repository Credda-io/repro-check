**Expected:** `settings.locale` is `en-GB`, the value in the config file.

**Actual:** it is `undefined`. repro-check 0.1.0, Node 20.11, Ubuntu 22.04.

```js
import { readFileSync } from 'node:fs';
const load = (p) => readFileSync(p, 'utf8');
const settings = parseConfig(load('./app.conf'));
console.log(settings.locale);
```
