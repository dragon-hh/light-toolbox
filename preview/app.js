const $ = selector => document.querySelector(selector);
const main = $('#main');
const catalog = [
  { id:'photo',number:'01',en:'ID PHOTO',name:'证件照',brief:'换个底色，体面出场',detail:'一寸 / 二寸 · 三色背景',icon:'scan-face',tone:'green',subtitle:'一张照片，刚刚好。' },
  { id:'lottery',number:'02',en:'LUCKY DRAW',name:'幸运转盘',brief:'把选择，交给好运',detail:'图文选项 · 自选概率',icon:'dices',tone:'yellow',subtitle:'今天，好运落谁家？' },
  { id:'pdf',number:'03',en:'PDF MERGE',name:'PDF 合并',brief:'零散文件，一次整理',detail:'自由排序 · 保留页面',icon:'files',tone:'orange',subtitle:'把零散，合成一份。' },
  { id:'compress',number:'04',en:'COMPRESS',name:'图像压缩',brief:'小一点，刚好发出去',detail:'自选质量 · 保留透明',icon:'minimize-2',tone:'stone',subtitle:'给图片，减个负。' }
];
const state = { config:null,token:sessionStorage.getItem('light.token'),files:[],quality:75,size:'one',background:'blue',sku:'month',busy:false,jobId:null,result:null,previewUrls:[],route:'home',tool:null };
const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = (name,cls='') => `<img class="${cls}" src="/assets/${name}.png" alt="">`;
const sizeLabel = n => n>=1048576 ? (n/1048576).toFixed(1)+' MB':Math.ceil(n/1024)+' KB';
function toast(message) { const element=$('#toast');element.textContent=message;element.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>element.hidden=true,6500); }
async function api(path,options={}) {
  const response=await fetch(path,{...options,headers:{Authorization:state.token ? 'Bearer '+state.token:'',...options.headers}});
  if(!response.ok) { const body=await response.json(); const error=Object.assign(new Error(body.error.message),body.error); if(response.status===401){state.token=null;sessionStorage.removeItem('light.token');} throw error; }
  return response.json();
}
async function login() {
  if(state.token) return;
  let deviceId=localStorage.getItem('light.device'); if(!deviceId){deviceId=crypto.randomUUID();localStorage.setItem('light.device',deviceId);}
  const result=await api('/api/auth/local',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId})});
  state.token=result.token;sessionStorage.setItem('light.token',result.token);
}
async function authed(path,options) { await login();return api(path,options); }
function errorBox(error) { return `<div class="error" role="alert">${esc(error.message)}${error.requestId ? `<br>错误编号：${esc(error.requestId)}`:''}</div>`; }
function home() {
  main.innerHTML=`<div class="row"><span class="eyebrow">YOUR EVERYDAY TOOLKIT</span><span class="pill"><span class="status-dot"></span>日常小事 · 随手解决</span></div><section class="hero"><h1>让小事，<br>轻一点<em>.</em></h1><div class="stamp">${icon('sparkles')}<span>LESS IS MORE</span></div><p>四件趁手工具，省下时间去生活。</p></section><div class="row section-head"><h2>今天，想做点什么？</h2><span class="eyebrow">04 TOOLS</span></div><div class="tool-grid">${catalog.map(t=>`<button class="tool-card ${t.tone}" data-tool="${t.id}"><div class="row"><span class="code">${t.number} / ${t.en}</span>${icon('arrow-up-right','arrow')}</div><div class="art">${icon(t.icon)}</div><h3>${t.name}</h3><p>${t.brief}</p><div class="detail">${t.detail}</div></button>`).join('')}</div><button class="member-banner" data-route="member"><div><h3>给生活，开个小外挂</h3><p>四款工具 · 30 天畅用</p></div><div class="banner-price"><small>¥</small>${state.prices.month.label}${icon('arrow-right')}</div></button><div class="footnotes"><span>按次 ¥${state.prices.single.label}</span><span>月卡手动续费</span><span>结果保留 1 小时</span></div><div class="signature">MADE WITH CARE BY LIGHT</div>`;
}
function toolPage(id) {
  const tool=catalog.find(t=>t.id===id); if(!tool)return home();
  state.tool=tool;state.files=[];state.result=null;state.jobId=null;
  if(id==='lottery')return window.mountWheel(main,state,authed,esc,toast);
  const available=state.config && state.config.tools.find(t=>t.id===id).available;
  main.innerHTML=`<button class="back" data-route="home">${icon('chevron-left')}返回工具箱</button><div class="eyebrow">TOOL ${tool.number} / ${tool.en}</div><div class="row tool-title"><h2>${tool.subtitle}</h2>${icon(tool.icon)}</div><div class="row"><span class="muted">${tool.detail}</span><span class="pill">本地免费体验 · 配置价格 ¥${state.prices.single.label} / 次</span></div>${!available?'<div class="notice">证件照人像分割服务尚未开通。可以查看界面，暂时无法生成。</div>':''}<div id="tool-error"></div>${`<input id="file-input" type="file" accept="${id==='pdf'?'.pdf':'image/jpeg,image/png,image/webp'}" ${id==='pdf'?'multiple':''} hidden><button class="drop-zone" data-action="choose"><div class="upload-icon">${icon('upload')}</div><h3>${id==='pdf'?'添加 PDF 文件':'选择一张照片'}</h3><p class="muted">${id==='pdf'?'自由排序 · 2–10 个文件':'从你的设备中选择'}</p></button><div class="small-note">${id==='pdf'?'单个 ≤10MB，总计 ≤40MB，最多 500 页；不支持加密文件。':id==='photo'?'正面半身照，头部居中并留出空隙。单张 ≤10MB。':'支持静态 JPG / PNG / WebP，单张 ≤10MB。'}</div><div id="files"></div>${id==='photo'?`<div class="panel"><h3>照片尺寸</h3><div class="options">${[['one','一寸','295 × 413'],['two','二寸','413 × 579'],['small','小一寸','260 × 378']].map(([value,name,dim])=>`<button class="option ${state.size===value?'selected':''}" data-size="${value}">${name}<div class="muted">${dim}</div></button>`).join('')}</div><h3 class="mt">背景颜色</h3><div class="options">${[['blue','蓝底'],['white','白底'],['red','红底']].map(([value,name])=>`<button class="option color-option ${state.background===value?'selected':''}" data-background="${value}"><span class="color-dot color-${value}"></span>${name}</button>`).join('')}</div><div class="notice">居中裁切 · 300 DPI · 不改变五官。请自行核对用途的尺寸要求。</div></div>`:id==='compress'?`<div class="panel"><div class="row"><h3>压缩质量</h3><span class="quality"><span id="quality-label">${state.quality}</span><small>%</small></span></div><input type="range" id="quality" min="20" max="95" step="5" value="${state.quality}" aria-label="压缩质量"><div class="row muted"><span>体积更小</span><span>画质更好</span></div><div class="notice">透明图片输出 WebP，其他图片输出 JPG。若不能缩小，将明确提示并保留原文件。</div></div>`:''}`}
    <div class="consent"><label><input type="checkbox" id="agreed"> 我已阅读并同意</label><button class="text-link" data-action="privacy">文件处理说明</button></div><button class="primary" id="run" data-action="run" ${!available?'disabled':''}>${id==='pdf'?'合并成一份 PDF':id==='photo'?'生成证件照':'开始压缩'}</button><div class="small-note">成功处理计 1 次 · 失败不扣次数 · 本地体验不扣费</div><div id="result"></div>`;
}
function invalidate() {state.jobId=null;state.result=null;const result=$('#result');if(result)result.innerHTML='';}
function renderFiles() {
  if(state.tool.id!=='pdf') {
    state.previewUrls.forEach(URL.revokeObjectURL);state.previewUrls=[];
    if(state.files.length){const url=URL.createObjectURL(state.files[0]);state.previewUrls.push(url);$('.drop-zone').innerHTML=`<img class="input-preview" src="${url}" alt="已选图片"><span class="replace">重新选择 · ${sizeLabel(state.files[0].size)}</span>`;}
  } else $('#files').innerHTML=state.files.map((file,i)=>`<div class="file-row"><span class="file-index">${i+1}</span><div class="file-info"><div class="file-name">${esc(file.name)}</div><div class="muted">${sizeLabel(file.size)}</div></div><button data-move="${i}" data-direction="-1" ${i===0?'disabled':''} aria-label="上移 ${esc(file.name)}">↑</button><button data-move="${i}" data-direction="1" ${i===state.files.length-1?'disabled':''} aria-label="下移 ${esc(file.name)}">↓</button><button data-remove="${i}" aria-label="删除 ${esc(file.name)}">×</button></div>`).join('');
}
async function resultView(result) {
  state.result=result;
  const target=$('#result');
  target.innerHTML=`<section class="panel result"><div class="row"><h3>完成了！</h3><span class="badge">${result.tool==='lottery'?'好运已揭晓':'可以带走啦'}</span></div>${result.winners?result.winners.map((n,i)=>`<div class="winner"><span>${i+1}.</span>${esc(n)}</div>`).join('')+'<button class="secondary mt" data-action="copy">复制抽取结果</button>':`${result.tool==='compress'?`<div class="result-stat">${sizeLabel(result.outputBytes)} · 缩小 ${result.savedPercent}%</div><div class="notice">${esc(result.note)}</div>`:result.tool==='pdf'?`<div class="result-stat">${result.files} 份文件 → ${result.pages} 页 PDF</div>`:`<div class="muted mt">${result.width} × ${result.height} px · 300 DPI</div>`}<div id="result-preview"></div><button class="primary mt" data-action="download">下载${result.tool==='pdf'?'合并后的 PDF':'图片'}</button>`}</section>`;
  target.scrollIntoView({behavior:'smooth',block:'nearest'});
  if(result.artifact && result.tool!=='pdf') {
    try { const blob=await getBlob(result.artifact);const url=URL.createObjectURL(blob);state.previewUrls.push(url);$('#result-preview').innerHTML=`<img class="result-image" src="${url}" alt="处理结果">`; }
    catch(error){toast('处理已完成，但预览下载失败：'+error.message);}
  }
}
async function run() {
  if(state.busy)return;
  if(!$('#agreed').checked){toast('请先阅读并同意文件处理说明');return;}
  const id=state.tool.id;
  if(state.files.length<(id==='pdf'?2:1)){toast(id==='pdf'?'请至少添加两个 PDF':'请先选择文件');return;}
  state.busy=true;$('#run').disabled=true;$('#run').textContent='正在处理，请稍候…';$('#tool-error').innerHTML='';
  if(!state.jobId)state.jobId=crypto.randomUUID();
  try {
    let body,headers={'Idempotency-Key':state.jobId};
    {body=new FormData();state.files.forEach(file=>body.append('files',file));body.append('quality',state.quality);body.append('size',state.size);body.append('background',state.background);}
    const result=await authed('/api/tools/'+id,{method:'POST',headers,body});state.jobId=null;await resultView(result);
  } catch(error){$('#tool-error').innerHTML=errorBox(error);if(error.code && error.code!=='JOB_PROCESSING')state.jobId=null;}
  finally{state.busy=false;$('#run').disabled=false;$('#run').textContent='再次处理';}
}
async function getBlob(artifact) {
  await login();const response=await fetch(artifact.url,{headers:{Authorization:'Bearer '+state.token}});
  if(!response.ok){const data=await response.json();throw new Error(data.error.message);}return response.blob();
}
async function download(artifact) {const blob=await getBlob(artifact);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=artifact.filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function member() {
  main.innerHTML=`<div class="eyebrow">A LITTLE MORE POSSIBILITY</div><h2 class="mt">好用的，都给你。</h2><p class="muted mt">偶尔用一次，或让轻松成为日常。</p><div id="profile"></div><div class="plans"><button class="plan ${state.sku==='single'?'chosen':''}" data-sku="single"><div class="row"><h3>用一次</h3><span class="radio"></span></div><div class="price"><small>¥</small>${state.prices.single.label}<span> / 次</span></div><p class="muted">四款工具任选 · 成功处理计次</p></button><button class="plan monthly ${state.sku==='month'?'chosen':''}" data-sku="month"><div class="row"><h3>轻松一个月</h3><span class="badge">常用更合适</span><span class="radio"></span></div><div class="price"><small>¥</small>${state.prices.month.label}<span> / 30天</span></div><p class="muted">四款工具畅用 · 每天约 ¥${state.prices.month.daily}</p><div class="plan-footer">证件照 / 抽奖 / PDF 合并 / 图像压缩</div></button></div><div class="benefits"><span>✓ 手动续费</span><span>✓ 失败不扣次数</span><span>✓ 无广告干扰</span></div><div class="terms">月卡自支付成功起连续 30 天，提前续费顺延；到期不自动扣款。单次权益不设到期日，成功处理计 1 次。iOS 退款需在 App Store 申请。</div><button class="primary" disabled>本地体验 · 不发起支付</button><div class="notice">正式版在微信内使用虚拟支付购买。此评审页面不会创建订单或模拟支付成功。</div><div class="panel"><h3>我的订单</h3><div id="orders" class="empty"><p class="muted">正在读取…</p></div></div>`;
  try {const [profile,orders]=await Promise.all([authed('/api/me'),authed('/api/orders')]);if(state.route!=='member')return;$('#profile').innerHTML=`<div class="panel profile row"><div><h3>你的工具箱</h3><div class="muted">编号 ${profile.id} · 本地体验</div></div><div class="credit"><b>${profile.credits}</b> 次可用</div></div>`;$('#orders').innerHTML=orders.length?orders.map(o=>`<p>${esc(o.sku)} · ¥${(o.price/100).toFixed(2)} · ${esc(o.status)}</p>`).join(''):'<p class="muted">还没有订单。需要时再买，刚刚好。</p>';}catch(error){if(state.route==='member')$('#profile').innerHTML=errorBox(error);}
}
async function records() {
  main.innerHTML='<div class="eyebrow">LITTLE THINGS, DONE.</div><h2 class="mt">做过的，都在这里。</h2><p class="muted mt">结果保留 1 小时，记得及时带走。</p><div id="records"><div class="notice">正在读取记录…</div></div>';
  try {const jobs=await authed('/api/jobs');if(state.route!=='records')return;state.jobs=jobs;$('#records').innerHTML=jobs.length?jobs.map((job,i)=>{const tool=catalog.find(t=>t.id===job.tool),expired=!job.result || (job.result.artifact && job.result.artifact.expiresAt<Date.now()),status=job.status==='processing'?'处理中':job.status==='failed'?'失败 · 未扣次数':expired?'结果已过期':'已完成';return `<div class="panel"><div class="row"><div class="record-icon ${tool.tone}">${icon(tool.icon)}</div><div class="record-info"><h3>${tool.name}</h3><p>${new Date(job.created_at).toLocaleString('zh-CN')}</p></div><span class="record-status">${status}</span></div><div class="record-bottom"><span class="record-id">${job.id}</span>${job.status==='succeeded'&&!expired?`<button class="text-link" data-result="${i}">查看结果 →</button>`:job.status==='processing'?'<button class="text-link" data-action="refresh-records">刷新状态</button>':''}</div>${job.status==='failed'?`<div class="notice">处理没有完成，次数已释放。错误：${esc(job.error)}</div>`:''}</div>`;}).join(''):`<div class="panel empty">${icon('folder-open')}<h3>你的第一个成果，正在路上</h3><p class="muted">选个小工具，把手头的小事搞定。</p><button class="primary" data-route="home">去工具箱看看</button></div>`;}catch(error){if(state.route==='records')$('#records').innerHTML=errorBox(error);}
}
function navigate(route,tool) {
  if(state.busy){toast('任务正在处理，请稍候');return;}
  state.previewUrls.forEach(URL.revokeObjectURL);state.previewUrls=[];state.route=route;
  document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.route===(route==='tool'?'home':route)));
  if(route==='home')home();else if(route==='tool')toolPage(tool);else if(route==='records')records();else member();window.scrollTo(0,0);
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button,a');if(!button)return;
  try {
    if(button.dataset.route){navigate(button.dataset.route);return;}if(button.dataset.tool){navigate('tool',button.dataset.tool);return;}
    if(button.matches('a.brand')){event.preventDefault();navigate('home');return;}
    const action=button.dataset.action;
    if(action==='privacy')$('#privacy').showModal();if(action==='close-dialog')$('#privacy').close();
    if(state.busy && !['privacy','close-dialog'].includes(action))return;
    if(action==='choose')$('#file-input').click();if(action==='run')await run();if(action==='download')await download(state.result.artifact);
    if(action==='copy'){await navigator.clipboard.writeText(state.result.winners.join('\n'));toast('抽取结果已复制');}
    if(action==='refresh-records')await records();
    for(const key of ['size','background'])if(button.dataset[key]){state[key]=button.dataset[key];button.parentElement.querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b===button));invalidate();}
    if(button.dataset.sku){state.sku=button.dataset.sku;document.querySelectorAll('.plan').forEach(b=>b.classList.toggle('chosen',b===button));}
    if(button.dataset.move!==undefined){const i=Number(button.dataset.move),j=i+Number(button.dataset.direction);[state.files[i],state.files[j]]=[state.files[j],state.files[i]];invalidate();renderFiles();}
    if(button.dataset.remove!==undefined){state.files.splice(Number(button.dataset.remove),1);invalidate();renderFiles();}
    if(button.dataset.result!==undefined){const job=state.jobs[Number(button.dataset.result)];if(job.result.artifact)await download(job.result.artifact);else toast('抽取结果：'+job.result.winners.join('、'));}
  }catch(error){toast(error.message);}
});
document.addEventListener('change',event=>{
  if(state.busy)return;
  if(event.target.id==='file-input') {
    const files=state.tool.id==='pdf' ? state.files.concat(Array.from(event.target.files)):Array.from(event.target.files);
    if(files.length>10 || files.some(f=>f.size>10*1048576) || files.reduce((n,f)=>n+f.size,0)>40*1048576){toast('最多10个文件，单个不超过10MB，总计不超过40MB');event.target.value='';return;}
    state.files=files;invalidate();renderFiles();event.target.value='';
  }
});
document.addEventListener('input',event=>{
  if(state.busy)return;
  if(event.target.id==='quality'){state.quality=Number(event.target.value);$('#quality-label').textContent=state.quality;invalidate();}
  if(['names','count'].includes(event.target.id))invalidate();
});
async function init(){try{state.config=await api('/api/config');state.prices=LightPricing.presentPrices(state.config.prices);home();}catch(error){main.innerHTML=errorBox(error);}}
init();
