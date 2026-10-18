import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planIntegration } from '../src/integration-policy.js'
import type {
  FileStamp,
  IntegrationObservation,
  IntegrationPlan,
} from '../src/integration-types.js'

function stampOf(char: 'a' | 'b' | 'c' | 'd', bytes: number): FileStamp {
  return { sha256: char.repeat(64), bytes }
}

interface ObservationInit {
  path?: string
  kind?: IntegrationObservation['kind']
  baseline?: FileStamp | null
  delivered?: FileStamp | null
  current?: FileStamp | null
  problem?: string
}

function observation(init: ObservationInit): IntegrationObservation {
  return {
    path: init.path ?? 'src/a.ts',
    kind: init.kind ?? 'modified',
    baseline: init.baseline ?? null,
    delivered: init.delivered ?? null,
    current: init.current ?? null,
    ...(init.problem === undefined ? {} : { problem: init.problem }),
  }
}

function brokenObservation(init: Record<string, unknown>): IntegrationObservation {
  return init as unknown as IntegrationObservation
}

function statusesOf(plan: IntegrationPlan): string[] {
  return plan.files.map((file) => file.reason.length > 0 ? file.status : 'MISSING_REASON')
}

test('addition, modification and deletion are ready when current matches the baseline', () => {
  const plan = planIntegration([
    observation({ path: 'new.ts', kind: 'added', baseline: null, delivered: stampOf('a', 10), current: null }),
    observation({ path: 'mod.ts', kind: 'modified', baseline: stampOf('b', 20), delivered: stampOf('c', 30), current: stampOf('b', 20) }),
    observation({ path: 'del.ts', kind: 'deleted', baseline: stampOf('d', 40), delivered: null, current: stampOf('d', 40) }),
  ])

  assert.deepEqual(statusesOf(plan), ['ready', 'ready', 'ready'])
  assert.deepEqual(plan.files.map((file) => file.path), ['new.ts', 'mod.ts', 'del.ts'])
  assert.equal(plan.status, 'ready')
  assert.equal(plan.canExport, true)
  assert.deepEqual(plan.counts, { ready: 3, conflict: 0, alreadyApplied: 0, blocked: 0 })
})

test('current equal to delivered by hash and bytes is already applied, including deletion', () => {
  const plan = planIntegration([
    observation({ path: 'mod.ts', kind: 'modified', baseline: stampOf('a', 10), delivered: stampOf('b', 20), current: stampOf('b', 20) }),
    observation({ path: 'del.ts', kind: 'deleted', baseline: stampOf('c', 30), delivered: null, current: null }),
  ])

  assert.deepEqual(statusesOf(plan), ['already_applied', 'already_applied'])
  assert.equal(plan.status, 'nothing_to_apply')
  assert.equal(plan.canExport, false)
  assert.deepEqual(plan.counts, { ready: 0, conflict: 0, alreadyApplied: 2, blocked: 0 })
  assert.ok(plan.files[1]?.reason.includes('不存在'))
})

test('missing current with non-null delivered is not already applied', () => {
  const plan = planIntegration([
    observation({ path: 'gone.ts', kind: 'modified', baseline: stampOf('a', 10), delivered: stampOf('b', 20), current: null }),
  ])

  assert.deepEqual(statusesOf(plan), ['conflict'])
  assert.equal(plan.status, 'blocked')
  assert.equal(plan.canExport, false)
})

test('added with unrelated existing content is a conflict, never treated as base', () => {
  const plan = planIntegration([
    observation({ path: 'dup.ts', kind: 'added', baseline: null, delivered: stampOf('a', 10), current: stampOf('c', 99) }),
  ])

  assert.deepEqual(statusesOf(plan), ['conflict'])
  assert.ok(plan.files[0]?.reason.includes('基线'))
})

test('conflict explains in Chinese that the original file changed since the baseline', () => {
  const plan = planIntegration([
    observation({ path: 'mod.ts', kind: 'modified', baseline: stampOf('a', 10), delivered: stampOf('b', 20), current: stampOf('c', 11) }),
    observation({ path: 'del.ts', kind: 'deleted', baseline: stampOf('a', 10), delivered: null, current: stampOf('b', 20) }),
  ])

  assert.deepEqual(statusesOf(plan), ['conflict', 'conflict'])
  for (const file of plan.files) {
    assert.equal(file.status, 'conflict')
    assert.ok(/[\u4e00-\u9fff]/.test(file.reason))
    assert.ok(file.reason.includes('基线'))
    assert.ok(!file.reason.includes('already_applied'))
  }
  assert.equal(plan.counts.conflict, 2)
})

test('same hash but different byte size is not equality', () => {
  const plan = planIntegration([
    observation({ path: 'size-a.ts', kind: 'modified', baseline: stampOf('a', 10), delivered: stampOf('a', 20), current: stampOf('a', 15) }),
    observation({ path: 'size-b.ts', kind: 'modified', baseline: stampOf('a', 10), delivered: stampOf('a', 20), current: stampOf('a', 10) }),
  ])

  assert.deepEqual(statusesOf(plan), ['conflict', 'ready'])
  assert.deepEqual(plan.counts, { ready: 1, conflict: 1, alreadyApplied: 0, blocked: 0 })
})

test('a non-empty problem wins over already-applied equality', () => {
  const plan = planIntegration([
    observation({
      path: 'mod.ts',
      kind: 'modified',
      baseline: stampOf('a', 10),
      delivered: stampOf('b', 20),
      current: stampOf('b', 20),
      problem: '权限不足，无法读取该文件。',
    }),
  ])

  assert.deepEqual(statusesOf(plan), ['blocked'])
  assert.equal(plan.files[0]?.reason, '权限不足，无法读取该文件。')
  assert.equal(plan.files[0]?.problem, '权限不足，无法读取该文件。')
  assert.equal(plan.status, 'blocked')
  assert.equal(plan.canExport, false)
})

test('a missing legacy baseline is blocked instead of invented', () => {
  const plan = planIntegration([
    observation({ path: 'mod.ts', kind: 'modified', baseline: null, delivered: stampOf('b', 20), current: stampOf('a', 10) }),
    observation({ path: 'del.ts', kind: 'deleted', baseline: null, delivered: null, current: stampOf('a', 10) }),
  ])

  assert.deepEqual(statusesOf(plan), ['blocked', 'blocked'])
  for (const file of plan.files) {
    assert.ok(file.reason.includes('基线'))
  }
})

test('stamp shape incompatible with the kind is blocked', () => {
  const plan = planIntegration([
    observation({ path: 'added.ts', kind: 'added', baseline: stampOf('a', 10), delivered: stampOf('b', 20), current: null }),
    observation({ path: 'added2.ts', kind: 'added', baseline: null, delivered: null, current: null }),
    observation({ path: 'del.ts', kind: 'deleted', baseline: stampOf('a', 10), delivered: stampOf('b', 20), current: stampOf('a', 10) }),
  ])

  assert.deepEqual(statusesOf(plan), ['blocked', 'blocked', 'blocked'])
  assert.ok(plan.files[0]?.reason.includes('新增'))
  assert.ok(plan.files[1]?.reason.includes('新增'))
  assert.ok(plan.files[2]?.reason.includes('删除'))
})

test('invalid stamps are blocked', () => {
  const plan = planIntegration([
    observation({ path: 'upper.ts', kind: 'modified', baseline: stampOf('a', 10), delivered: { sha256: 'A'.repeat(64), bytes: 5 }, current: stampOf('a', 10) }),
    observation({ path: 'short.ts', kind: 'modified', baseline: { sha256: 'a'.repeat(63), bytes: 5 }, delivered: stampOf('b', 20), current: stampOf('b', 20) }),
    observation({ path: 'neg.ts', kind: 'modified', baseline: stampOf('a', 10), delivered: stampOf('b', 20), current: { sha256: 'b'.repeat(64), bytes: -1 } }),
    observation({ path: 'frac.ts', kind: 'modified', baseline: stampOf('a', 10), delivered: { sha256: 'b'.repeat(64), bytes: 1.5 }, current: stampOf('a', 10) }),
    observation({ path: 'big.ts', kind: 'modified', baseline: stampOf('a', 10), delivered: { sha256: 'b'.repeat(64), bytes: Number.MAX_SAFE_INTEGER + 2 }, current: stampOf('a', 10) }),
    brokenObservation({ path: 'obj.ts', kind: 'modified', baseline: 'not-a-stamp', delivered: stampOf('b', 20), current: null }),
  ])

  assert.deepEqual(statusesOf(plan), Array(6).fill('blocked'))
  assert.ok(plan.files[3]?.reason.includes('bytes'))
  assert.ok(plan.files[5]?.reason.includes('基线'))
})

test('unrecognized kind is blocked and normalized to modified without hiding the raw value', () => {
  const plan = planIntegration([
    brokenObservation({ path: 'x.ts', kind: 'renamed', baseline: stampOf('a', 10), delivered: stampOf('b', 20), current: stampOf('a', 10) }),
    brokenObservation({ path: 'y.ts', kind: '', baseline: null, delivered: stampOf('b', 20), current: null }),
    brokenObservation({ path: 'z.ts', kind: null, baseline: stampOf('a', 10), delivered: stampOf('b', 20), current: stampOf('a', 10) }),
    brokenObservation({ path: 'w.ts', kind: 7, baseline: stampOf('a', 10), delivered: stampOf('b', 20), current: stampOf('a', 10) }),
  ])

  assert.deepEqual(statusesOf(plan), ['blocked', 'blocked', 'blocked', 'blocked'])
  assert.deepEqual(plan.files.map((file) => file.kind), ['modified', 'modified', 'modified', 'modified'])
  assert.deepEqual(plan.files.map((file) => file.path), ['x.ts', 'y.ts', 'z.ts', 'w.ts'])
  assert.ok(plan.files[0]?.reason.includes('变更类型'))
  assert.ok(plan.files[0]?.reason.includes('字符串 "renamed"'))
  assert.ok(plan.files[1]?.reason.includes('变更类型'))
  assert.ok(plan.files[1]?.reason.includes('字符串 ""'))
  assert.ok(plan.files[2]?.reason.includes('变更类型'))
  assert.ok(plan.files[2]?.reason.includes('null'))
  assert.ok(plan.files[3]?.reason.includes('变更类型'))
  assert.ok(plan.files[3]?.reason.includes('数字 7'))
})

test('aggregate counts, status and canExport for a mixed plan keep input order', () => {
  const observations = [
    observation({ path: '1.ts', kind: 'added', baseline: null, delivered: stampOf('a', 10), current: null }),
    observation({ path: '2.ts', kind: 'modified', baseline: stampOf('a', 10), delivered: stampOf('b', 20), current: stampOf('b', 20) }),
    observation({ path: '3.ts', kind: 'modified', baseline: stampOf('a', 10), delivered: stampOf('b', 20), current: stampOf('c', 30) }),
    observation({ path: '4.ts', kind: 'modified', baseline: stampOf('a', 10), delivered: stampOf('b', 20), current: stampOf('b', 20), problem: '文件被占用。' }),
  ]

  const plan = planIntegration(observations)

  assert.deepEqual(statusesOf(plan), ['ready', 'already_applied', 'conflict', 'blocked'])
  assert.deepEqual(plan.files.map((file) => file.path), ['1.ts', '2.ts', '3.ts', '4.ts'])
  assert.deepEqual(plan.counts, { ready: 1, conflict: 1, alreadyApplied: 1, blocked: 1 })
  assert.equal(plan.status, 'blocked')
  assert.equal(plan.canExport, false)
})

test('empty input yields zero counts, no export and nothing_to_apply', () => {
  const plan = planIntegration([])

  assert.deepEqual(plan.counts, { ready: 0, conflict: 0, alreadyApplied: 0, blocked: 0 })
  assert.deepEqual(plan.files, [])
  assert.equal(plan.status, 'nothing_to_apply')
  assert.equal(plan.canExport, false)
})

test('inputs are never mutated and returned stamps are copies', () => {
  const baseline = stampOf('a', 10)
  const delivered = stampOf('b', 20)
  const input = observation({ path: 'mod.ts', kind: 'modified', baseline, delivered, current: baseline })
  const inputs = [input]

  const plan = planIntegration(inputs)
  const file = plan.files[0]
  assert.ok(file)
  assert.ok(file.baseline)
  assert.ok(file.delivered)

  assert.notEqual(file, input)
  assert.notEqual(file.baseline, baseline)
  assert.notEqual(file.delivered, delivered)
  assert.deepEqual(inputs, [input])
  assert.equal(Object.keys(input).length, 5)

  file.baseline.sha256 = 'f'.repeat(64)
  file.baseline.bytes = 999
  assert.equal(baseline.sha256, 'a'.repeat(64))
  assert.equal(baseline.bytes, 10)

  delivered.sha256 = 'e'.repeat(64)
  assert.equal(file.delivered.sha256, 'b'.repeat(64))
  assert.equal(plan.files[0]?.delivered?.sha256, 'b'.repeat(64))
})
