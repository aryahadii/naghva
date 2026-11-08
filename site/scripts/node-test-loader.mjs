import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

// Match Astro's extensionless TypeScript and JSON imports in native Node tests.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && existsSync(new URL(`${specifier}.ts`, context.parentURL))) {
      specifier += '.ts';
    }
    const result = next(specifier, context);
    return result.url.endsWith('.json') ? { ...result, importAttributes: { type: 'json' } } : result;
  },
});
