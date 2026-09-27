(function(){
async function j(url,opt={}){const r=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d}
document.addEventListener('DOMContentLoaded',()=>{
 const list=document.getElementById('auditRequestList');
 async function load(){if(!list)return;try{const d=await j('/api/audit/requests');list.innerHTML=d.requests.map(r=>`<div class="auditor-request"><span class="request-no">${r.id}</span><div><b>${r.title}</b><small>${r.dept} · ${r.status}</small></div><button class="btn ${r.status==='APPROVED'?'btn-primary':'btn-ghost'}" data-id="${r.id}" data-status="${r.status}">${r.status==='APPROVED'?'Mark presentation ready':'View status'}</button></div>`).join('')}catch(e){list.innerHTML=`<div class="small-message">${e.message}</div>`}}
 load();
 document.getElementById('startCapture')?.addEventListener('click',async()=>{const title=prompt('Auditor question / request');if(!title)return;try{await j('/api/audit/requests',{method:'POST',body:JSON.stringify({title,dept:'QA'})});load()}catch(e){alert(e.message)}});
 list?.addEventListener('click',async e=>{const b=e.target.closest('[data-id]');if(!b)return;if(b.dataset.status!=='APPROVED')return alert(`Current status: ${b.dataset.status}`);try{await j(`/api/audit/requests/${b.dataset.id}`,{method:'POST',body:JSON.stringify({status:'PRESENTED'})});load()}catch(err){alert(err.message)}});
 document.querySelectorAll('.room-action').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;b.textContent='Completed ✓';}));
});
})();
