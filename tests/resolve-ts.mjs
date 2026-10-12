// Resolve hook: retry extensionless relative imports with .ts.
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); }
  catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && /^\.{1,2}\//.test(spec) && !/\.[cm]?[jt]s$/.test(spec)) return next(spec + '.ts', ctx);
    throw e;
  }
}
