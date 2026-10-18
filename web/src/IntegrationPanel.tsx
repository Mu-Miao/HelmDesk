import {useEffect,useRef,useState} from 'react';
import type {Task} from '../../src/types';
import type {IntegrationPreview,IntegrationPatch} from '../../src/integration-types';
import {tool} from './api';
import {IntegrationPreviewView} from './IntegrationPreview';

export function IntegrationPanel({task,csrf,onError}:{task:Task;csrf:string;onError:(message:string)=>void}){
  const paths=(task.changes??[]).map(c=>c.path),key=JSON.stringify(paths);
  const [selected,setSelected]=useState(paths),[preview,setPreview]=useState<IntegrationPreview|null>(null),[busy,setBusy]=useState(false),[download,setDownload]=useState('');
  const generation=useRef(0);
  useEffect(()=>{generation.current++;setPreview(null);setDownload('');setBusy(false);setSelected(JSON.parse(key));return()=>{generation.current++;};},[task.id,task.updatedAt,key]);
  const eligible=task.state==='completed'&&task.acceptance==='accepted'&&task.verification?.status==='passed';
  if(task.mode!=='files'||!paths.length)return null;
  function select(path:string,checked:boolean){generation.current++;setSelected(current=>checked?[...current,path]:current.filter(p=>p!==path));setPreview(null);setDownload('');}
  async function check(){
    const request=++generation.current;setBusy(true);setDownload('');
    try{const result=await tool<IntegrationPreview>('task_integration_check',{taskId:task.id,paths:selected},csrf);if(request===generation.current)setPreview(result);}
    catch(error:any){if(request===generation.current){setPreview(null);onError(error.message);}}
    finally{if(request===generation.current)setBusy(false);}
  }
  async function exportPatch(){
    if(!preview)return;
    const request=++generation.current;setBusy(true);setDownload('');
    try{
      const result=await tool<IntegrationPatch>('task_patch_export',{taskId:task.id,paths:selected,fingerprint:preview.fingerprint},csrf);
      if(request!==generation.current)return;
      const bytes=new TextEncoder().encode(result.patch),digest=await crypto.subtle.digest('SHA-256',bytes);
      if(request!==generation.current)return;
      const sha=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
      if(sha!==result.sha256)throw Error('补丁传输摘要不一致，已阻止下载');
      const url=URL.createObjectURL(new Blob([bytes],{type:'text/x-patch;charset=utf-8'})),anchor=document.createElement('a');
      anchor.href=url;anchor.download=result.filename;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setPreview(result.preview);setDownload(`已下载 ${result.filename} · 未应用到原项目`);
    }catch(error:any){if(request===generation.current){setPreview(null);onError(error.message);}}
    finally{if(request===generation.current)setBusy(false);}
  }
  return <section className="integration-panel" aria-label="交付整合">
    <h4>交付整合</h4><p className="caption">先核对当前原项目，再导出所选交付的补丁。</p>
    {!eligible?<p className="caption">任务完成、验证通过并验收通过后，可检查整合条件。</p>:<>
      <fieldset className="integration-selection" disabled={busy}><legend>选择交付文件（最多 20 个）</legend>{paths.map(path=><label key={path}><input type="checkbox" checked={selected.includes(path)} onChange={event=>select(path,event.target.checked)}/><span>{path}</span></label>)}</fieldset>
      {!selected.length?<p className="caption">请选择至少一个文件。</p>:selected.length>20?<p className="caption">当前选择超过 20 个文件，请缩小范围。</p>:<IntegrationPreviewView preview={preview} busy={busy||!csrf} onCheck={()=>void check()} onExport={()=>void exportPatch()}/>}
      {download?<p className="model-message" role="status">{download}</p>:null}
    </>}
  </section>;
}
