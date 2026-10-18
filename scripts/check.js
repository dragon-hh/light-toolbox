import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const walk=dir=>readdirSync(dir,{withFileTypes:true}).filter(e=>e.name!=='node_modules').flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const files=['project.config.json','package.json','cloudbaserc.json',...['miniprogram','server','cloud','cloudfunctions','scripts','preview','tests'].flatMap(walk)];
const snapshots=new Map(files.map(file=>[file,readFileSync(file)]));
let checked=0;
for(const file of files) {
  if(/\.(c?js|json|wxml|wxss|html|css)$/.test(file)) {
    const text=readFileSync(file,'utf8');assert.ok(!text.includes('\uFFFD'),`Invalid UTF-8: ${file}`);
    if(file.endsWith('.wxss'))assert.ok(!text.includes('%%HERESUFFIX%%'),`Compiled WXSS must not replace source: ${file}`);
    if(file.endsWith('.json'))JSON.parse(text);
    if(/\.c?js$/.test(file)) {const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(result.status,0,`${file}: ${result.stderr}`);}
    checked++;
  }
}
const project=JSON.parse(readFileSync('project.config.json'));
assert.equal(project.appid,'wx5492d17de04b205d');assert.ok(existsSync(project.miniprogramRoot));
const app=JSON.parse(readFileSync('miniprogram/app.json'));
for(const page of app.pages)for(const extension of ['js','json','wxml','wxss'])assert.ok(existsSync(`miniprogram/${page}.${extension}`),`Missing page file ${page}.${extension}`);
for(const tab of app.tabBar.list)assert.ok(app.pages.includes(tab.pagePath));
const wxmls=files.filter(f=>f.endsWith('.wxml'));
for(const file of wxmls) {
  const body=readFileSync(file,'utf8');
  assert.ok(!/<br\s*\//.test(body),`Native WXML does not use HTML br: ${file}`);
  for(const match of body.matchAll(/src="(\/assets\/[^"{]+)"/g))assert.ok(existsSync('miniprogram'+match[1]),`Missing asset: ${match[1]}`);
}
console.log(`Checked ${checked} source/config files, ${app.pages.length} native pages and local assets.`);
const base='E:/Program Files (x86)/Tencent/微信web开发者工具/code/package.nw/node_modules/wcc-exec';
if(existsSync(base+'/wcc.exe')) {
  const result=spawnSync(base+'/wcc.exe',['-d',...wxmls.map(f=>f.replaceAll('\\','/'))],{encoding:'utf8',maxBuffer:8*1024*1024});
  assert.equal(result.status,0,`WeChat WXML compiler: ${result.stderr || result.stdout}`);console.log('WeChat WXML native compiler: passed.');
  const wxss=files.filter(f=>f.endsWith('.wxss')).map(f=>f.replaceAll('\\','/'));
  // No -o: that flag consumes the next argument as an output filename and can overwrite a source file.
  for(const stylesheet of wxss) {
    const styles=spawnSync(base+'/wcsc.exe',[stylesheet],{encoding:'utf8',maxBuffer:8*1024*1024});
    assert.equal(styles.status,0,`WeChat WXSS compiler ${stylesheet}: ${styles.stderr || styles.stdout}`);
    assert.ok(styles.stdout.trim() && !styles.stdout.includes('Usage:'),`No compiled WXSS output: ${stylesheet}`);
  }
  console.log('WeChat WXSS native compiler: passed.');
} else console.log('WeChat native compiler unavailable: run compilation in DevTools before release.');
for(const [file,before] of snapshots)assert.ok(before.equals(readFileSync(file)),`Read-only check changed source file: ${file}`);
