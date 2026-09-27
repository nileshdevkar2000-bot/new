(function(){
  const localKnowledge=[
    [/deviation|deviations|recurring/i,'NEO connects deviations, incidents, CAPA, change control, SOPs, trends and linked evidence.'],
    [/audit|auditor|evidence pack|front room|back room/i,'Audit Command Center uses request capture, evidence retrieval, exact SOP references, evidence-pack preparation, SME verification and request history.'],
    [/sop|procedure/i,'NEO searches server-side controlled knowledge and returns source-linked snippets.'],
    [/capa|change control|change-control/i,'NEO correlates deviation history with CAPA and change-control preparation.'],
    [/qc/i,'QC access is server-enforced and limited to QC-scoped quality records.'],
    [/qa/i,'QA has broader review scope and can review incident activity across departments.'],
    [/clinical|trial|site selection|study/i,'Clinical NEO connects study intelligence, site feasibility, protocol risk, execution, data review and safety/regulatory handoffs.'],
    [/pharmacovigilance|pv|adverse event|safety case|signal detection/i,'PV NEO connects safety intake, case triage, narrative support, signal detection, literature review and regulatory reporting, with controlled Clinical and Quality bridges.'],
    [/google|web|internet|latest|news|current|today|recent/i,'NEO can use Google knowledge server-side when configured.'],
    [/theme|dark|light|color/i,'AI Color switches between Aurora, Light and Graphite modes.']
  ];
  function fallback(q){for(const [re,a] of localKnowledge)if(re.test(q))return a;return 'NEO can work across the authorized NEO workspace: QMS, deviations, incidents, CAPA, change control, SOPs, audit workflows, evidence, approvals, audit trail, departments and connected knowledge.';}
  const pageParams=new URLSearchParams(location.search), pageDept=pageParams.get('dept')||document.body?.dataset?.departmentSlug||'';
  const greetingByHour=()=>{const h=new Date().getHours();return h<12?'Good morning':h<17?'Good afternoon':h<22?'Good evening':'Good night';};
  function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function escapeAttr(s){return escapeHtml(s).replace(/javascript:/gi,'');}
  async function currentUser(){try{const r=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});const d=await r.json();return d.user||null;}catch{return null;}}
  function buildWelcome(user){
    const first=(user?.name||'there').trim().split(/\s+/)[0];
    const dept=(pageDept||user?.department||'NEO').replace(/^qa$/i,'QA').replace(/^qc$/i,'QC');
    return `${first}, welcome to NEO. ${greetingByHour()}. How may I help with your ${dept} team?`;
  }
  async function getAnswer(q,{web=false,connectors=true}={}){
    try{
      const threadHistory=[...document.querySelectorAll('#agentThread .thread-msg')].slice(-10).map(x=>({role:x.classList.contains('user')?'user':'assistant',content:x.dataset.rawText||x.textContent||''}));
      const r=await fetch('/api/neo-chat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:q,scope:pageDept?`department:${pageDept}`:'whole-neo',department:pageDept,web,connectors,history:threadHistory,pageTitle:document.title,pageUrl:location.pathname+location.search})});
      const d=await r.json().catch(()=>({}));
      if(r.ok&&d.answer)return d;
      if(r.status===401){location.href='/login.html?reason=timeout&next='+encodeURIComponent(location.pathname+location.search);return {answer:'Your NEO session expired. Please sign in again.',internal:[],web:[],connectors:[]};}
      return {answer:d.error||fallback(q),internal:[],web:[],connectors:[]};
    }catch(e){return {answer:fallback(q),internal:[],web:[],connectors:[]};}
  }
  function add(thread,role,text){const d=document.createElement('article');d.className='thread-msg '+role;d.textContent=text;d.dataset.rawText=text;thread.appendChild(d);thread.scrollTop=thread.scrollHeight;return d;}
  function addSources(thread,data){
    if((data.internal||[]).length===0&&(data.web||[]).length===0&&(data.connectors||[]).length===0)return;
    const wrap=document.createElement('div');wrap.className='thread-sources';
    wrap.innerHTML='<span class="source-label">Sources</span>'+
      (data.internal||[]).slice(0,4).map(x=>`<span class="source-chip internal">${escapeHtml(x.title||x.source||'NEO')}</span>`).join('')+
      (data.web||[]).slice(0,4).map(x=>`<a class="source-chip web" href="${escapeAttr(x.url||'#')}" target="_blank" rel="noreferrer">${escapeHtml(x.title||'Web')}</a>`).join('')+
      (data.connectors||[]).slice(0,6).map(x=>x.url?`<a class="source-chip connector" href="${escapeAttr(x.url)}" target="_blank" rel="noreferrer">${escapeHtml((x.connector||'Enterprise')+' · '+(x.title||'Record'))}</a>`:`<span class="source-chip connector">${escapeHtml((x.connector||'Enterprise')+' · '+(x.title||'Record'))}</span>`).join('');
    thread.appendChild(wrap);thread.scrollTop=thread.scrollHeight;
  }
  document.addEventListener('DOMContentLoaded',async()=>{
    const form=document.getElementById('agentForm'),input=document.getElementById('agentInput'),thread=document.getElementById('agentThread'),intro=document.getElementById('agentIntro');
    if(!form||!input||!thread)return;
    const user=await currentUser();
    if(user && !thread.children.length){add(thread,'assistant',buildWelcome(user)); if(intro)intro.style.display='none';}
    async function send(q){
      q=(q||'').trim();if(!q)return;
      if(intro)intro.style.display='none';
      add(thread,'user',q);
      const last=add(thread,'assistant','NEO is working…');
      const web=/\b(google|web|internet|latest|news|current|today|recent)\b/i.test(q);
      const cross=/\b(cross[- ]?functional|across departments|other department|QA|QC|clinical|pharmacovigilance|regulatory|manufacturing|supply chain|medical affairs)\b/i.test(q);
      const data=await getAnswer(q,{web,connectors:true,cross});
      last.textContent=data.answer||fallback(q);last.dataset.rawText=data.answer||fallback(q);addSources(thread,data);
      return data;
    }
    form.addEventListener('submit',e=>{e.preventDefault();const q=input.value;input.value='';send(q);});
    document.querySelectorAll('[data-prompt]').forEach(b=>b.addEventListener('click',()=>send(b.dataset.prompt)));
    document.getElementById('neoAgentVoice')?.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('neo:open-voice')));
    document.addEventListener('keydown',e=>{if((e.altKey||e.metaKey)&&e.key.toLowerCase()==='v'){e.preventDefault();document.dispatchEvent(new CustomEvent('neo:open-voice'));}if(e.key==='Escape')window.speechSynthesis?.cancel();});
    const qp=new URLSearchParams(location.search),initial=qp.get('prompt');if(initial)send(initial);
    window.NEOAgent={answer:getAnswer,send};
  });
})();
