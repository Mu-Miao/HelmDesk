import * as React from 'react'
import type { IntegrationPreview, IntegrationFile, IntegrationFileStatus, FileStamp } from '../../src/integration-types.js'

type Props = {
  preview: IntegrationPreview | null
  busy: boolean
  onCheck: () => void
  onExport: () => void
}

const PLAN_LABEL: Record<IntegrationPreview['status'], string> = {
  ready: '可导出补丁',
  blocked: '存在阻塞',
  nothing_to_apply: '无需整合',
}

const STATUS_LABEL: Record<IntegrationFileStatus, string> = {
  ready: '可整合',
  conflict: '有冲突',
  already_applied: '已一致',
  blocked: '不支持',
}

const KIND_LABEL: Record<IntegrationFile['kind'], string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
}

function Stamp({ label, stamp }: { label: string; stamp: FileStamp | null }) {
  return (
    <div className="integration-stamp">
      <dt>{label}</dt>
      <dd>{stamp ? stamp.sha256 : '不存在'}</dd>
      <dd>{stamp ? `${stamp.bytes} 字节` : '—'}</dd>
    </div>
  )
}

export function IntegrationPreviewView({ preview, busy, onCheck, onExport }: Props) {
  return (
    <section className="integration-preview" aria-label="整合预检结果">
      <div className="integration-toolbar">
        <button type="button" className="outline" disabled={busy} onClick={onCheck}>
          {preview ? '重新检查' : '检查整合条件'}
        </button>
        <button type="button" className="outline" disabled={busy || !preview?.canExport} onClick={onExport}>
          导出补丁
        </button>
        {busy ? <span className="integration-loading">正在检查…</span> : null}
      </div>

      {preview ? (
        <React.Fragment>
          <div className="integration-summary" role="status">
            <span className={`integration-status-${preview.status}`}>{PLAN_LABEL[preview.status]}</span>
            <span>检查快照 · <time dateTime={preview.checkedAt}>{new Date(preview.checkedAt).toLocaleString('zh-CN', {hour12:false})}</time></span>
          </div>

          <ul className="integration-counts">
            <li>可整合：{preview.counts.ready}</li>
            <li>有冲突：{preview.counts.conflict}</li>
            <li>已一致：{preview.counts.alreadyApplied}</li>
            <li>不支持：{preview.counts.blocked}</li>
          </ul>

          {preview.files.length === 0 ? (
            <p>没有需要整合的文件。</p>
          ) : (
            <ul className="integration-files">
              {preview.files.map((file) => (
                <li key={file.path} className="integration-file">
                  <div className={`integration-status-${file.status}`}>
                    <span className="integration-file-path">{file.path}</span>
                    <span className="integration-file-kind">{KIND_LABEL[file.kind]}</span>
                    <span className="integration-file-status">{STATUS_LABEL[file.status]}</span>
                  </div>
                  <p className="integration-reason">{file.reason}</p>
                  {file.problem && file.problem !== file.reason ? <p className="integration-problem">{file.problem}</p> : null}
                  <details className="integration-details">
                    <summary>摘要凭据</summary>
                    <dl className="integration-stamps">
                      <Stamp label="基线" stamp={file.baseline} />
                      <Stamp label="当前" stamp={file.current} />
                      <Stamp label="交付" stamp={file.delivered} />
                    </dl>
                  </details>
                </li>
              ))}
            </ul>
          )}

          <details className="integration-limits-panel"><summary>范围与导出说明</summary><ul className="integration-limits">
            {preview.limitations.map((limit, index) => (
              <li key={index}>{limit}</li>
            ))}
          </ul></details>

          <p>导出时再次核对，过期预览会被拒绝。下载仅生成补丁，原项目保持不变。</p>
        </React.Fragment>
      ) : (
        <p>
          整合预检会读取本次已验收并勾选的文件，与原项目当前状态进行比对，全程只读，绝不修改或写入原项目。
        </p>
      )}
    </section>
  )
}
