import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTs } from './load-ts.mjs'
import { mathCases } from './math-cases.mjs'

const { commandProblem } = await loadTs('src/policy.ts')
for (const fixture of mathCases) {
  test(`acceptance reference commands satisfy the ${fixture.mode} policy: ${fixture.id}`, () => {
    const known = new Set()
    for (const command of fixture.commands) {
      assert.equal(commandProblem(fixture.mode, command, { known, angleUnit: fixture.angleUnit || 'degree', enforceAngle: true }), null, command)
      const label = command.match(/^(\w+)\s*[:=]/)?.[1]
      if (label) known.add(label)
    }
  })
}
