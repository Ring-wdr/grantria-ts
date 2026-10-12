// node --test: resolve the app's extensionless relative imports ('./rules') to .ts files.
import { register } from 'node:module';

register('./resolve-ts.mjs', import.meta.url);
