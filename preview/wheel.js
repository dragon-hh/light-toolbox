window.mountWheel = function(main, state, authed, esc, toast) {
  const core=window.LightWheel,key='light.webwheel.v1';
  let saved=JSON.parse(localStorage.getItem(key)||'null'),draft=saved?saved.draft:core.defaults(),stage=saved?'spin':'edit',rotation=0,result=null;
  core.validate(draft);
  if(saved&&saved.last&&Date.now()-saved.last.at<3600000){core.validateResult(saved.last.result,draft.entries,saved.last.result.jobId);result=saved.last.result;rotation=(360-result.winnerIndex*360/draft.entries.length)%360;}
  function persist(value){localStorage.setItem(key,JSON.stringify(value));saved=value;}
  const button=(label,action,disabled=false)=>`<button data-wheel="${action}" ${disabled?'disabled':''}>${label}</button>`;
  function render(){
    main.innerHTML=`<section class="web-wheel"><div class="row"><span class="eyebrow">LIGHT / LUCKY WHEEL</span>${button('返回工具箱','home')}</div><h2>${stage==='edit'?'把期待，放进转盘。':'好运，转起来。'}</h2><p class="wheel-subtitle">01 配置图文选项 → 02 转动抽奖</p><div id="wheel-error" role="alert"></div>${stage==='edit'?editor():spinner()}</section>`;
    if(stage==='spin')draw().catch(error=>{showError(error);main.querySelector('[data-wheel="spin"]').disabled=true;});
  }
  function editor(){return `<label>转盘名称<input id="wheel-title" maxlength="24" value="${esc(draft.title)}"></label><div class="row mt"><h3>转盘选项 ${draft.entries.length} / 8</h3><span>图片 + 文字描述</span></div>${core.decorate(draft.entries,draft.weighted).map((e,i)=>`<div class="web-entry"><label class="web-image-picker">${e.image?`<img src="${esc(e.image)}" alt="更换第 ${i+1} 项图片">`:'添加图片'}<input type="file" accept="image/*" data-wheel-image="${i}" hidden></label><div class="web-entry-body"><textarea maxlength="40" data-wheel-label="${i}" aria-label="第 ${i+1} 项描述">${esc(e.label)}</textarea><div class="row"><span>${e.chance}</span>${draft.weighted?`<label>权重 <input type="number" min="1" max="100" value="${e.weight}" data-wheel-weight="${i}"></label>`:''}<div>${button('↑','up-'+i,i===0)} ${button('↓','down-'+i,i===draft.entries.length-1)} ${button('移除','remove-'+i,draft.entries.length<=2)}</div></div></div></div>`).join('')}<div class="row">${button('＋ 添加选项','add',draft.entries.length>=8)}<label><input id="wheel-weighted" type="checkbox" ${draft.weighted?'checked':''}> 自定义权重</label></div><p class="wheel-subtitle">默认等概率。权重为 1–100 的整数，扇区等大，概率按权重计算。图片与配置仅保存在当前浏览器。</p>${button('保存配置，进入转盘 ↗','save')}`;}
  function spinner(){return `<div class="row"><h3>${esc(draft.title)}</h3>${button('编辑转盘 ↗','edit',!!saved.pending)}</div><div class="web-machine"><div class="web-pointer"></div><canvas id="web-wheel-canvas" width="900" height="900" style="transform:rotate(${rotation}deg)"></canvas><div class="web-hub">LIGHT<br><b>GO</b></div></div><div id="web-prize">${result?prize(result):''}</div><label class="web-agree"><input id="web-wheel-agree" type="checkbox"> 我已阅读并同意处理说明：本次仅上传选项文字、编号及权重用于抽奖，结果保留 1 小时。</label>${button(saved.pending?'继续查询这次抽奖':result?'再转一次 ↻':'开始转动 ↻','spin')}<p class="wheel-subtitle">本地免费体验 · 每轮抽中一项 · 下一轮仍可再次抽中</p>${core.decorate(draft.entries,draft.weighted).map(e=>`<div class="web-legend"><img src="${esc(e.image)}" alt=""><span>${esc(e.label)}</span><b>${e.chance}</b></div>`).join('')}`;}
  function prize(r){return `<div class="web-prize"><span>好运已揭晓</span><div class="row"><img src="${esc(draft.entries[r.winnerIndex].image)}" alt=""><h3>${esc(r.winner.label)}</h3></div></div>`;}
  function showError(error){console.error('[LIGHT] preview.wheel',{code:error.code,message:error.message,requestId:error.requestId});const node=main.querySelector('#wheel-error');if(node)node.textContent=error.message;else toast(error.message);}
  async function draw(){
    const canvas=main.querySelector('#web-wheel-canvas'),ctx=canvas.getContext('2d'),images=await Promise.all(draft.entries.map(e=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('图片读取失败，请重新选择'));image.src=e.image;})));
    if(!canvas.isConnected)return;
    const step=2*Math.PI/draft.entries.length;
    draft.entries.forEach((e,i)=>{const angle=i*step-Math.PI/2;ctx.beginPath();ctx.moveTo(450,450);ctx.arc(450,450,446,angle-step/2,angle+step/2);ctx.closePath();ctx.fillStyle=core.COLORS[i];ctx.fill();ctx.strokeStyle='#183F35';ctx.lineWidth=3;ctx.stroke();ctx.save();ctx.translate(450,450);ctx.rotate(i*step);const side=draft.entries.length>6?116:140,y=-326,image=images[i],s=Math.min(image.width,image.height);ctx.save();ctx.beginPath();ctx.arc(0,y,side/2,0,Math.PI*2);ctx.clip();ctx.drawImage(image,(image.width-s)/2,(image.height-s)/2,s,s,-side/2,y-side/2,side,side);ctx.restore();ctx.fillStyle='#183F35';ctx.font='bold 29px sans-serif';ctx.textAlign='center';const chars=Array.from(e.label.trim());[chars.slice(0,4).join(''),chars.slice(4,8).join('')+(chars.length>8?'…':'')].forEach((line,n)=>ctx.fillText(line,0,y+side/2+32+n*34));ctx.restore();});
  }
  async function spin(){
    if(!main.querySelector('#web-wheel-agree').checked)throw new Error('请先阅读并同意处理说明');
    state.busy=true;main.querySelectorAll('button,input').forEach(e=>e.disabled=true);
    try{
      const payload=core.payload(draft),jobId=saved.pending?saved.pending.jobId:crypto.randomUUID();persist({draft,pending:{jobId},last:null});
      const answer=await authed('/api/tools/lottery',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':jobId},body:JSON.stringify(payload)});
      core.validateResult(answer,draft.entries,jobId);persist({draft,pending:null,last:{result:answer,at:Date.now()}});
      const canvas=main.querySelector('#web-wheel-canvas');rotation=core.landingAngle(rotation,answer.winnerIndex,draft.entries.length);canvas.style.transition='transform 5.2s cubic-bezier(.12,.72,.13,1)';canvas.style.transform=`rotate(${rotation}deg)`;
      await new Promise(resolve=>setTimeout(resolve,5280));result=answer;render();
    }catch(error){if(['JOB_FAILED','RESULT_EXPIRED','PAYMENT_REQUIRED','INVALID_ENTRIES','INVALID_TITLE','INVALID_WEIGHT','DUPLICATE_ENTRIES'].includes(error.code))persist({draft,pending:null,last:null});render();showError(error);}
    finally{state.busy=false;main.querySelectorAll('[data-wheel="spin"]').forEach(e=>e.disabled=false);}
  }
  main.onclick=async event=>{const target=event.target.closest('[data-wheel]');if(!target||state.busy)return;const action=target.dataset.wheel;try{
    if(action==='home'){main.onclick=null;main.onchange=null;main.oninput=null;document.querySelector('[data-route="home"]').click();return;}
    if(action==='spin'){await spin();return;}
    if(action==='save'){core.validate(draft);persist({draft,pending:null,last:null});stage='spin';rotation=0;result=null;}
    else if(action==='edit'){stage='edit';}
    else if(action==='add'){if(draft.entries.length>=8)return;draft.entries.push({id:crypto.randomUUID(),label:'',image:'',weight:1});}
    else if(action.startsWith('remove-')){if(draft.entries.length<=2)return;draft.entries.splice(Number(action.slice(7)),1);}
    else if(action.startsWith('up-')||action.startsWith('down-')){const i=Number(action.split('-')[1]),j=i+(action.startsWith('up-')?-1:1);if(j<0||j>=draft.entries.length)return;[draft.entries[i],draft.entries[j]]=[draft.entries[j],draft.entries[i]];}
    render();
  }catch(error){showError(error);}};
  main.oninput=event=>{if(state.busy)return;const e=event.target;if(e.id==='wheel-title')draft.title=e.value;if(e.dataset.wheelLabel!==undefined)draft.entries[Number(e.dataset.wheelLabel)].label=e.value;if(e.dataset.wheelWeight!==undefined)draft.entries[Number(e.dataset.wheelWeight)].weight=e.value;};
  main.onchange=async event=>{if(state.busy)return;const e=event.target;try{if(e.id==='wheel-weighted'){draft.weighted=e.checked;render();}if(e.dataset.wheelWeight!==undefined)render();if(e.dataset.wheelImage!==undefined&&e.files[0]){const file=e.files[0];if(file.size>3*1048576)throw new Error('请选择 3MB 以内的图片');state.busy=true;try{const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d'),s=Math.min(bitmap.width,bitmap.height);ctx.drawImage(bitmap,(bitmap.width-s)/2,(bitmap.height-s)/2,s,s,0,0,256,256);bitmap.close();draft.entries[Number(e.dataset.wheelImage)].image=canvas.toDataURL('image/png');render();}finally{state.busy=false;}}}catch(error){showError(error);}};
  render();
};
