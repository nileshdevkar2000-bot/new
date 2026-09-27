(function(){
async function json(url,options={}){const r=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Request failed ${r.status}`);return d}
function q(id){return document.getElementById(id)}
function statusLabel(s){return String(s||'').replaceAll('_',' ')}
function row(r, actions){return `<div class="auditor-request" data-request="${r.id}"><span class="request-no">${r.id}</span><div><b>${r.title}</b><small>${r.dept} · ${statusLabel(r.status)}</small></div><div>${actions||''}</div></div>`}
async function loadRequests(target, actionMap){const out=q(target);if(!out)return;try{const d=await json('/api/audit/requests');out.innerHTML=d.requests.map(r=>row(r,actionMap(r))).join('')||'<div class="small-message">No audit requests.</div>';}catch(e){out.innerHTML=`<div class="small-message">${e.message}</div>`}}
async function transition(id,next,extra={}){return json(`/api/audit/requests/${encodeURIComponent(id)}`,{method:'POST',body:JSON.stringify({status:next,...extra})})}
function bindActionButtons(){document.querySelectorAll('[data-transition]').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;try{await transition(b.dataset.id,b.dataset.transition,{note:b.dataset.note||''});location.reload()}catch(e){alert(e.message);b.disabled=false}}))}
document.addEventListener('DOMContentLoaded',()=>{
  const target=q('auditRequestList');
  if(target){
    const mode=document.body.dataset.auditMode||'';
    const map=r=>{
      if(mode==='front'){
        if(r.status==='APPROVED') return `<button class="btn btn-primary" data-transition="PRESENTED" data-id="${r.id}">Present evidence</button>`;
        return `<button class="btn btn-ghost" data-id="${r.id}" data-log-question="1">View status</button>`;
      }
      if(mode==='back'){
        if(r.status==='REQUESTED') return `<button class="btn btn-primary" data-transition="SEARCHED" data-id="${r.id}">Retrieve evidence</button>`;
        if(r.status==='SEARCHED') return `<button class="btn btn-primary" data-transition="PACK_PREPARED" data-id="${r.id}">Prepare pack</button>`;
        return `<span class="tag">${statusLabel(r.status)}</span>`;
      }
      if(mode==='sop') return `<button class="btn btn-ghost" data-sop-id="${r.id}">Find exact SOP</button>`;
      if(mode==='pack') return `<button class="btn btn-primary" data-transition="SME_REVIEW" data-id="${r.id}">Send to SME</button>`;
      if(mode==='sme') return `<button class="btn btn-primary" data-transition="APPROVED" data-id="${r.id}">Approve verified evidence</button>`;
      return '';
    };
    loadRequests('auditRequestList',map).then(bindActionButtons).catch(()=>{});
  }
  q('refreshAuditRequests')?.addEventListener('click',()=>location.reload());
  const addForm=q('newAuditRequest');
  addForm?.addEventListener('submit',async e=>{e.preventDefault();try{await json('/api/audit/requests',{method:'POST',body:JSON.stringify({title:q('auditTitle').value,dept:q('auditDept').value})});location.reload()}catch(err){q('auditFormMessage').textContent=err.message}});
  document.querySelectorAll('[data-log-question]').forEach(b=>b.addEventListener('click',()=>alert('Request status is visible. Use the Back Room workflow to prepare evidence.')));
  document.querySelectorAll('[data-sop-id]').forEach(b=>b.addEventListener('click',async()=>{const box=q('sopResults');box.textContent='Searching controlled internal knowledge…';try{const d=await json('/api/knowledge/search',{method:'POST',body:JSON.stringify({q:b.dataset.sopId+' SOP procedure sampling cleaning change control'})});box.innerHTML=d.results.map(x=>`<div class="card"><span class="tag">${x.source}</span><h3>${x.title}</h3><p>${x.snippet}</p></div>`).join('')||'<div class="small-message">No exact internal match.</div>';}catch(e){box.textContent=e.message}}));
  q('createPack')?.addEventListener('click',async()=>{const id=q('packRequest')?.value;if(!id)return;try{await json('/api/audit/packs',{method:'POST',body:JSON.stringify({requestId:id,sources:[q('packSources')?.value||'Internal NEO source search']})});await transition(id,'SME_REVIEW');location.reload()}catch(e){q('packMessage').textContent=e.message}});
  q('smeForm')?.addEventListener('submit',async e=>{e.preventDefault();const id=q('smeRequest').value;try{await json('/api/audit/sme',{method:'POST',body:JSON.stringify({requestId:id,decision:q('smeDecision').value,notes:q('smeNotes').value})});q('smeMessage').textContent='SME review recorded.';loadRequests('auditRequestList',()=>'<span class="tag">Updated</span>')}catch(err){q('smeMessage').textContent=err.message}});
});
})();
