import type {
  FileStamp,
  IntegrationFile,
  IntegrationFileStatus,
  IntegrationObservation,
  IntegrationPlan,
} from './integration-types.js'

type ObservationKind = IntegrationObservation['kind']
type StampField = 'baseline' | 'delivered' | 'current'

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const KNOWN_KINDS: readonly string[] = ['added', 'modified', 'deleted']

const FIELD_LABELS: Record<StampField, string> = {
  baseline: '基线',
  delivered: '交付',
  current: '当前',
}

const KIND_LABELS: Record<ObservationKind, string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
}

const READY_REASONS: Record<ObservationKind, string> = {
  added: '该文件在任务基线中不存在，当前磁盘上也不存在，可以落地交付的新增内容。',
  modified: '当前内容与任务基线指纹一致，说明原始文件未被改动，可以应用交付内容。',
  deleted: '当前内容仍与任务基线指纹一致，可以按交付要求删除该文件。',
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function clip(text: string): string {
  return text.length > 72 ? `${text.slice(0, 72)}…` : text
}

function describeValue(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return `字符串 "${clip(value)}"`
    case 'number':
      return `数字 ${String(value)}`
    case 'boolean':
      return `布尔值 ${String(value)}`
    case 'undefined':
      return '缺失'
    case 'function':
      return '函数'
    case 'bigint':
      return `整数 ${String(value)}`
    case 'symbol':
      return '符号'
    default:
      return value === null ? 'null' : Array.isArray(value) ? '数组' : '对象'
  }
}

function isKnownKind(value: unknown): value is ObservationKind {
  return typeof value === 'string' && KNOWN_KINDS.includes(value)
}

function copyStamp(value: unknown): FileStamp | null {
  const record = asRecord(value)
  if (record === null) {
    return null
  }
  const sha256 = record['sha256']
  const bytes = record['bytes']
  return {
    sha256: typeof sha256 === 'string' ? sha256 : '',
    bytes: typeof bytes === 'number' ? bytes : Number.NaN,
  }
}

function stampsEqual(a: FileStamp | null, b: FileStamp | null): boolean {
  if (a === null || b === null) {
    return a === b
  }
  return a.sha256 === b.sha256 && a.bytes === b.bytes
}

function stampShapeProblem(value: unknown, field: StampField): string | null {
  if (value === null) {
    return null
  }
  const label = FIELD_LABELS[field]
  const record = asRecord(value)
  if (record === null) {
    return `${label}指纹必须是 null 或包含 sha256 与 bytes 的对象，实际为${describeValue(value)}。`
  }
  const sha256 = record['sha256']
  if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
    return `${label}指纹的 sha256 不是 64 位小写十六进制的 SHA256，实际为${describeValue(sha256)}。`
  }
  const bytes = record['bytes']
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
    return `${label}指纹的 bytes 不是非负安全整数，实际为${describeValue(bytes)}。`
  }
  return null
}

function requireStamp(value: unknown, field: StampField, kind: ObservationKind): string | null {
  const shape = stampShapeProblem(value, field)
  if (shape !== null) {
    return shape
  }
  if (value === null) {
    const note = field === 'baseline' ? '，且不会伪造缺失的历史基线' : ''
    return `${KIND_LABELS[kind]}类文件缺少${FIELD_LABELS[field]}指纹，无法确认对应内容${note}。`
  }
  return null
}

function requireNullStamp(value: unknown, field: StampField, kind: ObservationKind): string | null {
  const shape = stampShapeProblem(value, field)
  if (shape !== null) {
    return shape
  }
  if (value !== null) {
    return `${KIND_LABELS[kind]}类文件的${FIELD_LABELS[field]}指纹必须为 null，但检测到指纹，记录形状与变更类型不匹配。`
  }
  return null
}

function kindShapeProblem(record: Record<string, unknown>, kind: ObservationKind): string | null {
  const baseline = record['baseline']
  const delivered = record['delivered']
  const current = record['current']
  if (kind === 'added') {
    return (
      requireNullStamp(baseline, 'baseline', kind) ??
      requireStamp(delivered, 'delivered', kind) ??
      stampShapeProblem(current, 'current')
    )
  }
  if (kind === 'modified') {
    return (
      requireStamp(baseline, 'baseline', kind) ??
      requireStamp(delivered, 'delivered', kind) ??
      stampShapeProblem(current, 'current')
    )
  }
  return (
    requireStamp(baseline, 'baseline', kind) ??
    requireNullStamp(delivered, 'delivered', kind) ??
    stampShapeProblem(current, 'current')
  )
}

function blockedRecord(index: number): IntegrationFile {
  return {
    path: '',
    kind: 'modified',
    baseline: null,
    delivered: null,
    current: null,
    status: 'blocked',
    reason: `第 ${String(index + 1)} 条观测记录不是有效对象，无法参与集成。`,
  }
}

function classify(input: unknown, index: number): IntegrationFile {
  const record = asRecord(input)
  if (record === null) {
    return blockedRecord(index)
  }

  const rawPath = record['path']
  const rawKind = record['kind']
  const rawProblem = record['problem']
  const path: string = typeof rawPath === 'string' ? rawPath : ''
  // The DTO kind must stay inside the union; the raw unknown kind survives only in the blocked reason.
  const kind: ObservationKind = isKnownKind(rawKind) ? rawKind : 'modified'

  const baseline = copyStamp(record['baseline'])
  const delivered = copyStamp(record['delivered'])
  const current = copyStamp(record['current'])

  const decide = (status: IntegrationFileStatus, reason: string): IntegrationFile => ({
    path,
    kind,
    baseline,
    delivered,
    current,
    ...(typeof rawProblem === 'string' ? { problem: rawProblem } : {}),
    status,
    reason,
  })

  if (typeof rawProblem === 'string' && rawProblem.trim() !== '') {
    return decide('blocked', rawProblem)
  }

  if (!isKnownKind(rawKind)) {
    return decide(
      'blocked',
      `无法识别的变更类型（实际为${describeValue(rawKind)}），仅支持 added、modified、deleted，需要先修正观测记录。`,
    )
  }

  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    return decide(
      'blocked',
      `第 ${String(index + 1)} 条观测记录缺少有效的文件路径，形状与集成契约不匹配。`,
    )
  }

  const shapeProblem = kindShapeProblem(record, kind)
  if (shapeProblem !== null) {
    return decide('blocked', `${path}：${shapeProblem}`)
  }

  if (stampsEqual(current, delivered)) {
    return decide(
      'already_applied',
      delivered === null
        ? `${path} 已经不存在，当前状态与交付结果一致，无需再次应用。`
        : `${path} 当前内容的哈希与字节数与交付内容完全一致，说明交付已经应用，无需重复处理。`,
    )
  }

  if (stampsEqual(current, baseline)) {
    return decide('ready', `${path}：${READY_REASONS[kind]}`)
  }

  return decide(
    'conflict',
    `${path} 的原始文件自任务基线以来已发生变化：当前内容与基线指纹不一致，需要先人工确认再继续集成。`,
  )
}

export function planIntegration(observations: IntegrationObservation[]): IntegrationPlan {
  const files: IntegrationFile[] = []
  const counts = { ready: 0, conflict: 0, alreadyApplied: 0, blocked: 0 }

  for (let index = 0; index < observations.length; index += 1) {
    const file = classify(observations[index], index)
    files.push(file)
    if (file.status === 'ready') {
      counts.ready += 1
    } else if (file.status === 'conflict') {
      counts.conflict += 1
    } else if (file.status === 'already_applied') {
      counts.alreadyApplied += 1
    } else {
      counts.blocked += 1
    }
  }

  const canExport = counts.ready > 0 && counts.conflict === 0 && counts.blocked === 0
  const status: IntegrationPlan['status'] =
    counts.conflict > 0 || counts.blocked > 0
      ? 'blocked'
      : counts.ready > 0
        ? 'ready'
        : 'nothing_to_apply'

  return { status, canExport, counts, files }
}
