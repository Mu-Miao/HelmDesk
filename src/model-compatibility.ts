import type {Task} from './types.js';import type {ModelOption} from './model-types.js';
export function modelCompatibility(options:ModelOption[],tasks:Task[]):ModelOption[]{
  return options.map(option=>{
    if(option.kind!=='custom')return{...option};
    // Retain the three explicit validation records created before probePurpose existed.
    const task=tasks.find(t=>(t.agent??'qoder-cn')==='qoder-cn'&&t.model===option.id&&t.mode==='probe'&&(t.probePurpose==='model-compatibility'||t.title===`P6 自定义兼容探测 ${option.id}`)&&(t.state==='failed'||t.state==='completed'&&t.verification?.status==='passed'&&t.acceptance==='accepted'));
    if(!task)return{...option};
    const passed=task.state==='completed'&&task.verification?.status==='passed'&&task.acceptance==='accepted';
    if(task.state==='completed'&&!passed)return{...option};
    return{...option,compatibility:{status:passed?'passed' as const:'failed' as const,taskId:task.id,at:task.updatedAt,reason:passed?'最近一次隔离短问候通过；不代表长任务或文件工具均已验证':'最近一次隔离短探测失败；检查供应商连接后可明确重做无工具探测，不自动换模型'}};
  });
}
