(function(){
  const TIMEOUT=180000;
  if(!window.__NEOFetchGuard){
    window.__NEOFetchGuard=true;
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async function(input,init){
      const response=await nativeFetch(input,init);
      const url=typeof input==='string'?input:(input?.url||'');
      const publicAuth=/\/api\/(login|signup|password\/|registration-options|public-status|session)(?:$|\?)/.test(url);
      if(response.status===401&&!publicAuth&&!/^\/login\.html/.test(location.pathname)){
        const next=location.pathname+location.search;
        sessionStorage.setItem('neo.logoutReason','timeout');
        location.href='/login.html?reason=timeout&next='+encodeURIComponent(next);
      }
      return response;
    };
  }
  let state=null, lastTouch=0, timer=null;
  async function session(){try{const r=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});state=await r.json();return state.authenticated?state.user:null}catch{return null}}
  async function logout(reason){try{await fetch('/api/logout',{method:'POST',credentials:'same-origin'})}catch{};state=null;if(reason)sessionStorage.setItem('neo.logoutReason',reason);location.href='/login.html?reason='+(reason==='timeout'?'timeout':'logout')}
  async function touch(){const now=Date.now();if(now-lastTouch<15000)return;lastTouch=now;try{const r=await fetch('/api/touch',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'}});if(r.status===401)await logout('timeout')}catch{}}
  document.addEventListener('DOMContentLoaded',async()=>{
    const user=await session();
    const protectedPage=document.body.classList.contains('workspace-page')||document.body.classList.contains('agent-page');
    if(protectedPage&&!user){location.href='/login.html?next='+encodeURIComponent(location.pathname+location.search);return}
    ['click','keydown','mousemove','touchstart','scroll'].forEach(e=>document.addEventListener(e,()=>{if(user)touch()},{passive:true}));
    timer=setInterval(async()=>{const u=await session();if(!u){clearInterval(timer);if(protectedPage)await logout('timeout')}},15000);
    document.querySelectorAll('#logoutBtn,#agentLogout').forEach(b=>b.addEventListener('click',()=>logout('manual')));
    document.querySelectorAll('[data-role]').forEach(el=>{el.textContent=user?.role||''});
    document.querySelectorAll('[data-user-name]').forEach(el=>{el.textContent=user?.name||'NEO User'});
    document.querySelectorAll('[data-session-department]').forEach(el=>{el.textContent=user?.department||'—'});
    document.querySelectorAll('[data-system-admin-only]').forEach(el=>{el.hidden=user?.role!=='SYSTEM_ADMIN'});
    window.NEOAuth={session:()=>user,logout,touch,isQA:()=>user?.role==='QA'||user?.role==='SYSTEM_ADMIN',isQC:()=>user?.role==='QC',isAdmin:()=>user?.role==='SYSTEM_ADMIN'};
    if(user&&protectedPage&&!document.getElementById('neo-live-assistant-script')){const sc=document.createElement('script');sc.id='neo-live-assistant-script';sc.src='/assets/live-assistant.js';sc.defer=true;document.head.appendChild(sc)}
  });
})();
