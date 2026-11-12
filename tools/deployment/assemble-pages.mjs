import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,v,i,a)=>i%2===0?[...pairs,[v.replace(/^--/,''),a[i+1]]]:pairs,[]));
for(const key of ['production','beta','output'])if(!args[key])throw new Error(`Missing --${key}`);
const production=path.resolve(args.production),beta=path.resolve(args.beta),output=path.resolve(args.output);
if([production,beta].some(input=>output===input||output.startsWith(input+path.sep)||input.startsWith(output+path.sep)))throw new Error('Input/output directories must be separate');
for(const input of [production,beta])if(!fs.existsSync(path.join(input,'index.html')))throw new Error(`Missing built index: ${input}`);
function files(dir,prefix=''){
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const name=path.join(prefix,entry.name);
  if(entry.isSymbolicLink())throw new Error(`Symlink rejected: ${name}`);
  if(['.private','.git','node_modules'].includes(entry.name))throw new Error(`Non-public directory rejected: ${name}`);
  return entry.isDirectory()?files(path.join(dir,entry.name),name):[name];
 });
}
const productionFiles=files(production).filter(name=>name!=='beta'&&!name.startsWith('beta'+path.sep));
const betaFiles=files(beta);
fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});
for(const name of productionFiles){const dest=path.join(output,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(production,name),dest);}
fs.mkdirSync(path.join(output,'beta'));for(const name of betaFiles){const dest=path.join(output,'beta',name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(beta,name),dest);}
const swPath=path.join(output,'sw.js');let sw=fs.readFileSync(swPath,'utf8');
// Existing approved builds predate the beta navigation exclusion.
if(!(sw.includes('denylist')&&sw.includes('beta'))){
 const navigation=/new ([\w$]+)\.NavigationRoute\(\1\.createHandlerBoundToURL\("index\.html"\)\)/;
 if(!navigation.test(sw))throw new Error('Unknown production service-worker navigation handler; refusing to publish');
 sw=sw.replace(navigation,(_,alias)=>`new ${alias}.NavigationRoute(${alias}.createHandlerBoundToURL("index.html"),{denylist:[/^\\/AGPilot0007\\/beta(?:\\/|$)/]})`);
}
// A visitor with the old root SW can initially receive its cached app at /beta/.
// Once that worker updates, revisit only beta windows so they load the beta app.
// Old Workbox cleanup matches nested scopes too; keep beta's independently scoped cache.
sw=sw.replace(/\b[\w$]+\.cleanupOutdatedCaches\(\),/g,'');
const migration=`/* film-studio-beta-navigation */\nself.addEventListener('activate',event=>{event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{for(const client of clients){if(/^\\/AGPilot0007\\/beta(?:\\/|$)/.test(new URL(client.url).pathname))client.navigate(client.url).catch(()=>{});}}));});\n`;
if(!sw.includes('film-studio-beta-navigation'))sw=migration+sw;
fs.writeFileSync(swPath,sw);
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for(const name of productionFiles)if(name!=='sw.js'&&digest(path.join(production,name))!==digest(path.join(output,name)))throw new Error(`Production changed: ${name}`);
const manifest=JSON.parse(fs.readFileSync(path.join(output,'beta','manifest.webmanifest'),'utf8'));
if(manifest.scope!=='/AGPilot0007/beta/'||manifest.start_url!=='/AGPilot0007/beta/')throw new Error('Invalid beta PWA scope');
console.log(`Assembled ${productionFiles.length} production files + ${betaFiles.length} beta files. Only root sw.js receives the beta routing/cache isolation and migration.`);
