export const INPUT_DIRECTORY = '.helmdesk-inputs';
export interface InputSelection { taskId: string; paths: string[] }
export interface InputSource {
  id:string; title:string; state:string; acceptance:string;
  verification?:{status:string};
  changes?:{path:string;kind:string;sha256?:string;bytes?:number}[];
}
export interface InputFile { taskId:string; title:string; path:string; sha256:string; bytes:number; mountedPath:string }
export interface InputRun { files:InputFile[]; isolationVerified:boolean; integrity:'pinned'|'verified'|'failed'; error?:string }
