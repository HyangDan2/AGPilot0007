import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
const repo=process.env.GITHUB_REPOSITORY||'HyangDan2/AGPilot0007';
if(!/^[\w.-]+\/[\w.-]+$/.test(repo))throw new Error('Invalid repository');
const output=path.resolve(process.argv[2]||'.production-root');
const gh=(...args)=>execFileSync('gh',args,{encoding:'utf8'});
const api=route=>JSON.parse(gh('api',`repos/${repo}/${route}`));
const runs=api('actions/workflows/deploy.yml/runs?branch=main&status=success&per_page=1').workflow_runs;
if(!runs.length)throw new Error('No approved successful main deployment');
const main=runs[0];
const artifacts=api(`actions/runs/${main.id}/artifacts`).artifacts;
const pages=artifacts.find(a=>a.name==='github-pages'&&!a.expired);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'film-studio-production-'));
try{
 fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});
 if(pages){
  gh('run','download',String(main.id),'--repo',repo,'--name','github-pages','--dir',temp);
  const archive=path.join(temp,'artifact.tar');
  const entries=execFileSync('tar',['-tf',archive],{encoding:'utf8'}).split('\n').filter(Boolean);
  if(entries.some(name=>path.isAbsolute(name)||name.split('/').includes('..')))throw new Error('Unsafe archive path');
  fs.mkdirSync(path.join(output,'site'));
  execFileSync('tar',['-xf',archive,'-C',path.join(output,'site')]);
  fs.rmSync(path.join(output,'site','beta'),{recursive:true,force:true});
  fs.writeFileSync(path.join(output,'metadata.json'),JSON.stringify({mainSha:main.head_sha,mainRun:main.id}));
 }else{
  // Pages artifacts expire quickly; the beta workflow keeps an approved root snapshot for 90 days.
  const snapshots=api('actions/artifacts?name=production-root&per_page=100').artifacts.filter(a=>!a.expired);
  let found=false;
  for(const snapshot of snapshots){
   const dest=path.join(temp,String(snapshot.id));
   gh('run','download',String(snapshot.workflow_run.id),'--repo',repo,'--name','production-root','--dir',dest);
   const metadata=JSON.parse(fs.readFileSync(path.join(dest,'metadata.json'),'utf8'));
   if(metadata.mainSha!==main.head_sha)continue;
   fs.cpSync(dest,output,{recursive:true});found=true;break;
  }
  if(!found)throw new Error('Approved production artifact expired and no matching snapshot exists; no deployment performed');
 }
 if(!fs.existsSync(path.join(output,'site','index.html')))throw new Error('Incomplete production snapshot');
 console.log(`Preserved approved main ${main.head_sha} from deployment ${main.id}`);
}finally{fs.rmSync(temp,{recursive:true,force:true});}
