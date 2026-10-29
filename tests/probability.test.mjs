import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTs } from './load-ts.mjs'

const { probabilitySelection } = await loadTs('src/probability.ts')

test('left-tail and point probabilities retain their distribution and bounds', () => {
  assert.deepEqual(probabilitySelection(['p = Normal(0, 1, 1.96, true)']), {
    type: 0, parameters: '0,1', cumulative: true,
    interval: { mode: '1', low: '1.96', high: '1.96' },
  })
  assert.deepEqual(probabilitySelection(['p = BinomialDist(10, 0.5, 6, false)']).interval,
    { mode: '0', low: '6', high: '6' })
})

test('CDF subtraction shows the full continuous interval rather than the final left tail', () => {
  const selection = probabilitySelection(['p = Normal(0, 1, 2, true) - Normal(0, 1, -1, true)'])
  assert.deepEqual(selection, {
    type: 0, parameters: '0,1', cumulative: false,
    interval: { mode: '0', low: '-1', high: '2' },
  })
})

test('parenthesized CDF subtraction and direct normal intervals agree', () => {
  const expected = probabilitySelection(['p = Normal(0, 1, -1, 2)'])
  assert.deepEqual(probabilitySelection(['p = (Normal(0, 1, 2, true)) - (Normal(0, 1, -1, true))']), expected)
})

test('arithmetic distribution parameters and discrete right tails use inclusive UI bounds', () => {
  assert.deepEqual(probabilitySelection(['p = 1 - Poisson(1 + 2, 4 - 1, true)']), {
    type: 14, parameters: '3', cumulative: false,
    interval: { mode: '2', low: '4', high: '4' },
  })
  assert.deepEqual(probabilitySelection(['p = 1 - BinomialDist(2 * 5, 1 / 2, 3.5, true)']).interval,
    { mode: '2', low: '4', high: '4' })
})

test('continuous right tails do not shift their lower bound', () => {
  assert.deepEqual(probabilitySelection(['p = 1 - Normal(0, 1, 2, true)']).interval,
    { mode: '2', low: '2', high: '2' })
})

test('discrete CDF differences shift the excluded lower bound', () => {
  assert.deepEqual(probabilitySelection(['p = Poisson(3, 6, true) - Poisson(3, 2, true)']).interval,
    { mode: '0', low: '3', high: '6' })
})

test('known numeric variables, constants, powers and scientific notation are resolved without eval', () => {
  const resolve = (name) => ({ mu: 2, sd: 0.5, k: 4 })[name]
  assert.deepEqual(probabilitySelection(['p = 1 - Normal(mu, sd, k - 1, true)'], resolve), {
    type: 0, parameters: '2,0.5', cumulative: false,
    interval: { mode: '2', low: '3', high: '3' },
  })
  assert.equal(probabilitySelection(['p = Normal(-2^2, 2^(-1), 1e-3, true)']).parameters, '-4,0.5')
  assert.equal(probabilitySelection(['p = Normal(0, pi / pi, 1, true)']).parameters, '0,1')
})

test('unrecognized expressions never masquerade as the last distribution call', () => {
  for (const command of [
    'p = Normal(0, 1, 2, true) - Normal(2, 1, 1, true)',
    'p = Normal(0, 1, 2, true) + Normal(0, 1, 1, true)',
    'p = 2 * Normal(0, 1, 2, true)',
    'p = Normal(0, 0/0, 2, true)',
    'p = Normal(0, missing, 2, true)',
    'p = Normal(0,, 1, 2, true)',
    'p = 1 - Poisson(3, 4, false)',
    'p = Normal(0, 1, 2, true); globalThis.injection = 1',
  ]) assert.equal(probabilitySelection([command]), null, command)
  assert.equal(globalThis.injection, undefined)
})

test('continuous densities show a density curve rather than a zero-width probability interval', () => {
  assert.equal(probabilitySelection(['d = Normal(0, 1, 2, false)']).interval, null)
})

test('the latest usable command determines the displayed distribution', () => {
  assert.equal(probabilitySelection(['p = Normal(0,1,2,true)', 'Poisson(3, false)']).type, 14)
})
