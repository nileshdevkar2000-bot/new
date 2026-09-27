(function(){
  document.addEventListener('DOMContentLoaded', async ()=>{
    const slug=document.body.dataset.departmentSlug;
    const output=document.querySelector('[data-dept-agent-output]');
    const set=(sel,v)=>document.querySelectorAll(sel).forEach(x=>x.textContent=v);
    if(!slug) return;
    try{
      const r=await fetch('/api/departments/summary?dept='+encodeURIComponent(slug),{credentials:'same-origin',cache:'no-store'});
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||'Unable to load department summary');
      set('[data-dept-incidents]',d.kpis.openIncidents);
      set('[data-dept-deviations]',d.kpis.openDeviations);
      set('[data-dept-audit]',d.kpis.openAudit);
      set('[data-dept-trends]',d.kpis.signals);
      const recent=document.querySelector('[data-dept-audit-list]');
      if(d.limited && output) output.textContent='This department overview is visible, but record-level actions remain restricted to your authorized scope.'; if(recent) recent.innerHTML=(d.recent||[]).map(x=>`<div class="dept-activity-row"><span class="tag">${x.kind}</span><div><b>${x.id}</b><span>${x.title}</span></div><em>${x.status}</em></div>`).join('') || '<div class="small-message">No matching records in the authorized scope.</div>';
      const play=document.querySelector('[data-ai-playbook]');
      if(play) play.innerHTML=(d.aiPlaybook||[]).map(x=>`<button class="prompt-chip" data-dept-prompt="Help me with ${x} in the ${d.department.name} department.">${x}</button>`).join('');
      try{const sr=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});const sd=await sr.json();if(sd.user&&output){const first=(sd.user.name||'there').trim().split(/\s+/)[0];const h=new Date().getHours();const g=h<12?'Good morning':h<17?'Good afternoon':h<22?'Good evening':'Good night';output.textContent=`${first}, welcome to NEO. ${g}. How may I help with your ${d.department.name} team?`;}}catch{}
      document.querySelectorAll('[data-dept-prompt]').forEach(b=>b.addEventListener('click',async()=>{
        const q=b.dataset.deptPrompt;
        if(output){output.textContent='NEO is working…'; const result=await (window.NEOAgent?.answer(q)||Promise.resolve({answer:'NEO Agent is ready.'})); output.textContent=result?.answer||String(result||'NEO Agent is ready.');}
      }));
      const bridges=document.querySelector('[data-department-bridges]');
      if(bridges) bridges.innerHTML=(d.bridges||[]).map(x=>`<span class="bridge-pill">${x}</span>`).join('');
    }catch(e){ if(output) output.textContent=e.message; }
  });
})();