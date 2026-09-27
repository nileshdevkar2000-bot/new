(function(){
  if (window.__NEOVoiceCompanion) return;
  window.__NEOVoiceCompanion = true;
  const state = { recognizing:false, speaking:false, active:false, finalText:'', timer:null, recognition:null, voices:[] };
  const esc = (s)=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function init(){
    if (location.pathname === '/login.html' || location.pathname === '/signup.html' || location.pathname === '/forgot-password.html' || location.pathname === '/index.html' || location.pathname === '/') return;
    let session;
    try { const r = await fetch('/api/session',{credentials:'same-origin',cache:'no-store'}); session = await r.json(); } catch { return; }
    if (!session?.authenticated) return;

    const pageDept = new URLSearchParams(location.search).get('dept') || document.body.dataset.departmentSlug || session.user?.department || '';
    const mount = document.createElement('div');
    mount.id='neoVoiceCompanion';
    mount.innerHTML=`<div class="neo-voice-companion-shell">
      <button class="neo-voice-orb" id="neoVoiceOrb" aria-label="Talk to NEO" title="Talk to NEO"><span class="neo-voice-core">N</span><span class="neo-voice-wave"></span></button>
      <div class="neo-voice-panel" id="neoVoicePanel" hidden>
        <div class="neo-voice-head"><div><div class="eyebrow gradient">NEO LIVE COMPANION</div><strong>Always ready to listen</strong><small>${esc(session.user?.department||'Whole NEO')} · ${esc(session.user?.role||'Authorized')}</small></div><button id="neoVoiceClose" class="btn btn-ghost">×</button></div>
        <div class="neo-voice-visual" id="neoVoiceVisual"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
        <div class="neo-voice-state" id="neoVoiceState">Tap Start and speak naturally.</div>
        <div class="neo-voice-transcript" id="neoVoiceTranscript">Your conversation with NEO stays within your authorized workspace scope.</div>
        <div class="neo-voice-actions"><button class="btn btn-primary" id="neoVoiceStart">🎙 Start listening</button><button class="btn btn-ghost" id="neoVoiceStop">Stop</button><a class="btn btn-ghost" href="/agent.html?voice=1&dept=${encodeURIComponent(pageDept||'')}">Full Live Mode</a></div>
        <label class="neo-voice-hands"><input type="checkbox" id="neoVoiceAuto" checked> Keep listening after NEO answers</label>
      </div>
    </div>`;
    document.body.appendChild(mount);

    const panel=mount.querySelector('#neoVoicePanel'), orb=mount.querySelector('#neoVoiceOrb'), close=mount.querySelector('#neoVoiceClose'), start=mount.querySelector('#neoVoiceStart'), stop=mount.querySelector('#neoVoiceStop'), stateEl=mount.querySelector('#neoVoiceState'), tx=mount.querySelector('#neoVoiceTranscript'), visual=mount.querySelector('#neoVoiceVisual'), auto=mount.querySelector('#neoVoiceAuto');
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if (!SR) { start.disabled=true; stateEl.textContent='Live browser voice input is not available here. Use Full Live Mode on a supported browser.'; }
    function setState(text,live=false){ stateEl.textContent=text; visual.classList.toggle('live',!!live); orb.classList.toggle('live',!!live); }
    function stopSpeaking(){ if(window.speechSynthesis) window.speechSynthesis.cancel(); state.speaking=false; }
    function fillVoices(){ state.voices=(window.speechSynthesis?.getVoices?.()||[]); }
    fillVoices(); if(window.speechSynthesis) window.speechSynthesis.onvoiceschanged=fillVoices;
    function speak(text){
      if(!window.speechSynthesis) return;
      stopSpeaking();
      const clean=String(text||'').replace(/\s+/g,' ').trim();
      if(!clean) return;
      const u=new SpeechSynthesisUtterance(clean.length>1000?clean.slice(0,1000):clean);
      const v=state.voices.find(x=>/^en-IN$/i.test(x.lang))||state.voices.find(x=>/^en/i.test(x.lang)); if(v)u.voice=v;
      u.rate=1.02; u.pitch=1;
      u.onstart=()=>{state.speaking=true;setState('NEO is speaking…',true);};
      u.onend=()=>{state.speaking=false; if(auto.checked){setState('Listening…',true); startRecognition();}else setState('Ready');};
      u.onerror=()=>{state.speaking=false;setState('Ready');};
      window.speechSynthesis.speak(u);
    }
    async function ask(q){
      setState('NEO is analysing internal knowledge…',true);
      try{
        const r=await fetch('/api/neo-chat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:q,scope:pageDept?`department:${pageDept}`:'whole-neo',department:pageDept,connectors:true,web:/\b(latest|recent|today|current|news|google|internet|web)\b/i.test(q)})});
        const d=await r.json().catch(()=>({}));
        if(r.status===401){location.href='/login.html?next='+encodeURIComponent(location.pathname+location.search);return;}
        if(!r.ok) throw new Error(d.error||'NEO is unavailable');
        tx.textContent=d.answer||'NEO did not return an answer.';
        speak(d.answer||'I could not produce an answer.');
      }catch(e){ tx.textContent=e.message||'NEO is unavailable.'; setState('Assistant unavailable'); }
    }
    function startRecognition(){
      if(!state.recognition || state.recognizing || state.speaking) return;
      state.finalText=''; state.active=true;
      try{ state.recognition.start(); }catch{}
    }
    function stopRecognition(send=false){
      clearTimeout(state.timer);
      if(state.recognition && state.recognizing){ try{state.recognition.stop();}catch{} }
      if(send && state.finalText.trim()){ const q=state.finalText.trim(); state.finalText=''; ask(q); }
      state.active=false;
      if(!state.speaking) setState('Ready');
    }
    if(SR){
      const rec=new SR(); state.recognition=rec; rec.lang=navigator.language||'en-IN'; rec.interimResults=true; rec.continuous=true;
      rec.onstart=()=>{state.recognizing=true;setState('Listening…',true);};
      rec.onresult=(e)=>{let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)state.finalText+=(state.finalText?' ':'')+t;else interim+=t;}tx.textContent=[state.finalText,interim].filter(Boolean).join(' ');clearTimeout(state.timer);if(state.finalText.trim())state.timer=setTimeout(()=>stopRecognition(true),850);};
      rec.onerror=(e)=>{state.recognizing=false;setState('Mic error: '+e.error);};
      rec.onend=()=>{state.recognizing=false;if(auto.checked && state.active && !state.speaking) setTimeout(startRecognition,120);};
    }
    orb.addEventListener('click',()=>{panel.hidden=!panel.hidden;if(!panel.hidden) start.focus();});
    close.addEventListener('click',()=>{panel.hidden=true;stopRecognition(false);stopSpeaking();});
    start.addEventListener('click',()=>{panel.hidden=false;startRecognition();});
    stop.addEventListener('click',()=>{auto.checked=false;stopRecognition(false);stopSpeaking();setState('Stopped');});
    navigator.mediaDevices?.getUserMedia?.({audio:true}).then(s=>s.getTracks().forEach(t=>t.stop())).catch(()=>{});
  }
  document.addEventListener('DOMContentLoaded',init);
})();
