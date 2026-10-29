import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { transformAsync } from '@babel/core'
import solid from 'babel-preset-solid'

let sequence = 0

async function compileSolid(contents, filename) {
  const transformed = await transformAsync(contents, {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
    presets: [[solid, { generate: 'dom' }]],
  })
  return transformed.code
}

// Bundle the real TypeScript modules; replace only external services in DOM tests.
export async function loadTs(filename, { mocks = {}, source } = {}) {
  const absolute = path.resolve(filename)
  const transformedSource = source === undefined ? undefined : await compileSolid(source, absolute)
  const result = await build({
    ...(source === undefined
      ? { entryPoints: [absolute] }
      : { stdin: { contents: transformedSource, sourcefile: absolute, resolveDir: path.dirname(absolute), loader: 'ts' } }),
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    conditions: ['browser'],
    define: { 'import.meta.env.DEV': 'false' },
    logLevel: 'silent',
    plugins: [{
      name: 'test-services-and-solid',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (Object.hasOwn(mocks, args.path)) return { path: args.path, namespace: 'test-mock' }
        })
        build.onLoad({ filter: /.*/, namespace: 'test-mock' }, (args) => ({
          contents: mocks[args.path], loader: 'js', resolveDir: process.cwd(),
        }))
        build.onLoad({ filter: /\.tsx$/ }, async (args) => {
          const contents = await readFile(args.path, 'utf8')
          return { contents: await compileSolid(contents, args.path), loader: 'ts' }
        })
      },
    }],
  })
  const code = result.outputFiles[0].text + `\n// test module ${sequence++}`
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
