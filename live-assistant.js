(function(){
  const boot=async()=>{
    if(!document.body.classList.contains('workspace-page') && !document.body.classList.contains('agent-page')) return;
    if(document.getElementById('neoLiveDock')) return;
    let session;
    try{const r=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});const d=await r.json();if(!d.authenticated){return;}session=d;}catch{return;}
    const pageDept=document.body.dataset.departmentSlug||new URLSearchParams(location.search).get('dept')||session.user?.department||'';
    const first=(session.user?.name||'there').trim().split(/\s+/)[0];
    const hour=new Date().getHours(),timeGreeting=hour<12?'Good morning':hour<17?'Good afternoon':hour<22?'Good evening':'Good night';
    const displayDept=String(pageDept||session.user?.department||'NEO').replace(/^qa$/i,'QA').replace(/^qc$/i,'QC');
    const greeting=`${first}, welcome to NEO. ${timeGreeting}. How may I help with your ${displayDept} team?`;

    const wrap=document.createElement('div');wrap.id='neoLiveDock';wrap.className='neo-live-dock';
    wrap.innerHTML=`<button class="neo-live-orb" id="neoLiveOrb" type="button" aria-label="Talk to NEO" title="Talk to NEO"><span class="neo-live-ring"></span><span class="neo-live-core">N</span></button>
    <section class="neo-live-panel" id="neoLivePanel" hidden aria-label="NEO voice conversation">
      <header class="neo-live-head"><div><div class="eyebrow gradient">NEO</div><strong>${first}, I’m listening</strong><small>${displayDept} context · ${session.user?.role||'Authorized user'}</small></div><button id="neoLiveClose" class="neo-live-x" type="button" aria-label="Close">×</button></header>
      <div class="neo-live-stage" id="neoLiveStage"><div class="neo-live-spark"></div><div class="neo-live-orb-large">N</div><div class="neo-live-status" id="neoLiveStatus">Tap the microphone and talk naturally</div></div>
      <div class="neo-live-transcript" id="neoLiveTranscript" aria-live="polite"></div>
      <footer class="neo-live-actions"><button id="neoLiveStart" class="btn btn-primary" type="button">🎙 Start conversation</button><button id="neoLiveMute" class="btn btn-ghost" type="button" disabled>Mute</button><button id="neoLiveStop" class="btn btn-ghost" type="button" disabled>End</button></footer>
      <div class="neo-live-footnote">Voice uses your current NEO permissions. NEO can search authorized internal knowledge, connected enterprise systems and Google web knowledge when configured.</div>
    </section>`;
    document.body.appendChild(wrap);

    const orb=wrap.querySelector('#neoLiveOrb'),panel=wrap.querySelector('#neoLivePanel'),close=wrap.querySelector('#neoLiveClose'),start=wrap.querySelector('#neoLiveStart'),mute=wrap.querySelector('#neoLiveMute'),stop=wrap.querySelector('#neoLiveStop'),status=wrap.querySelector('#neoLiveStatus'),tx=wrap.querySelector('#neoLiveTranscript'),stage=wrap.querySelector('#neoLiveStage');
    let ws=null,audio=null,stream=null,source=null,processor=null,playing=[],closed=true,muted=false,reconnecting=false,browserRec=null,browserMode=false,browserFinal='';
    const append=(who,text)=>{const p=document.createElement('p');p.className=who==='You'?'neo-live-you':'neo-live-neo';p.innerHTML=`<span>${who}</span>${escapeHtml(String(text||''))}`;tx.appendChild(p);tx.scrollTop=tx.scrollHeight;};
    const escapeHtml=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const setStatus=(t,on=false)=>{status.textContent=t;stage.classList.toggle('is-live',on);orb.classList.toggle('is-live',on);};
    const stopPlayback=()=>{playing.forEach(x=>{try{x.stop()}catch{}});playing=[];};
    const b64=float32=>{const buf=new ArrayBuffer(float32.length*2),v=new DataView(buf);for(let i=0;i<float32.length;i++){const x=Math.max(-1,Math.min(1,float32[i]));v.setInt16(i*2,x<0?x*32768:x*32767,true)}let s='',a=new Uint8Array(buf);for(const x of a)s+=String.fromCharCode(x);return btoa(s)};
    const pcm=b64s=>{const s=atob(b64s),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return new Int16Array(a.buffer)};
    const play=b64s=>{if(!audio)return;const p=pcm(b64s),buf=audio.createBuffer(1,p.length,24000),d=buf.getChannelData(0);for(let i=0;i<p.length;i++)d[i]=p[i]/32768;const src=audio.createBufferSource();src.buffer=buf;src.connect(audio.destination);src.start();playing.push({src,stop:()=>src.stop()});src.onended=()=>{playing=playing.filter(x=>x.src!==src);if(!playing.length&&!closed)setStatus('Listening…',true)};setStatus('NEO is speaking…',true)};
    function speakFallback(text){if(!window.speechSynthesis)return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(String(text||''));u.rate=1.03;u.pitch=1;u.onstart=()=>setStatus('NEO is speaking…',true);u.onend=()=>{if(!closed)setStatus('Listening…',true)};speechSynthesis.speak(u)}
    function startBrowserFallback(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)throw new Error('Live browser voice is unavailable here. Use Chrome or Edge.');browserMode=true;browserRec=new SR();browserRec.lang=navigator.language||'en-IN';browserRec.continuous=true;browserRec.interimResults=true;browserRec.onstart=()=>setStatus('Listening…',true);browserRec.onresult=async e=>{let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)browserFinal+=(browserFinal?' ':'')+t;else interim+=t}setStatus(interim||browserFinal||'Listening…',true);if(browserFinal.trim()){const q=browserFinal.trim();browserFinal='';append('You',q);try{const r=await fetch('/api/neo-chat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:q,department:pageDept,web:true,connectors:true,history:[],pageTitle:document.title,pageUrl:location.pathname+location.search})});const d=await r.json().catch(()=>({}));if(r.status===401){location.href='/login.html?reason=timeout&next='+encodeURIComponent(location.pathname+location.search);return;}if(!r.ok)throw new Error(d.error||'NEO is unavailable');append('NEO',d.answer);speakFallback(d.answer)}catch(err){append('NEO',err.message);setStatus('Assistant unavailable',false)}}};browserRec.onerror=e=>{if(e.error!=='no-speech')setStatus('Voice error: '+e.error,false)};browserRec.onend=()=>{if(browserMode&&!closed&&!muted){try{browserRec.start()}catch{}}};browserRec.start();}
    async function startAudio(){audio=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});await audio.resume();stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});source=audio.createMediaStreamSource(stream);processor=audio.createScriptProcessor(512,1,1);const muteGain=audio.createGain();muteGain.gain.value=0;source.connect(processor);processor.connect(muteGain);muteGain.connect(audio.destination);processor.onaudioprocess=e=>{if(ws?.readyState===1&&!muted)ws.send(JSON.stringify({realtimeInput:{audio:{data:b64(e.inputBuffer.getChannelData(0)),mimeType:'audio/pcm;rate=16000'}}}))};setStatus('Listening…',true)}
    function stopAudio(){try{processor?.disconnect();source?.disconnect();stream?.getTracks().forEach(t=>t.stop());audio?.close()}catch{}processor=source=stream=audio=null;}
    async function tool(name,args){
      try{
        if(name==='search_internal_knowledge'){const r=await fetch('/api/knowledge/search',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:String(args?.query||''),limit:8,department:pageDept})});return await r.json().catch(()=>({}))}
        if(name==='search_enterprise_knowledge'){const r=await fetch('/api/connectors/search',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:String(args?.query||''),connectors:[]})});return await r.json().catch(()=>({}))}
        if(name==='run_department_voice_workflow'){const r=await fetch('/api/voice/workflow',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({department:pageDept,action:String(args?.action||'general'),query:String(args?.query||'')})});return await r.json().catch(()=>({}))}
      }catch(e){return {error:e.message}}
      return {error:'Unknown tool'};
    }
    async function connect(){
      const r=await fetch('/api/voice/live-token',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({department:pageDept,pageTitle:document.title,pageUrl:location.pathname+location.search})});
      const tok=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(tok.error||'Gemini Live is not configured');
      ws=new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token='+encodeURIComponent(tok.token));
      ws.onopen=async()=>{closed=false;muted=false;setStatus('Connecting to NEO…',true);const vp=tok.voiceProfile||{};const decl=[{name:'search_internal_knowledge',description:'Search permission-scoped internal NEO knowledge.',parameters:{type:'OBJECT',properties:{query:{type:'STRING'}},required:['query']}},{name:'search_enterprise_knowledge',description:'Search approved enterprise connectors.',parameters:{type:'OBJECT',properties:{query:{type:'STRING'}},required:['query']}}];if(vp.department==='Clinical Trial'||vp.department==='Pharmacovigilance')decl.push({name:'run_department_voice_workflow',description:'Run a department-specific Clinical or PV workflow.',parameters:{type:'OBJECT',properties:{action:{type:'STRING'},query:{type:'STRING'}},required:['action','query']}});ws.send(JSON.stringify({setup:{model:'models/'+tok.model,generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Kore'}}}},inputAudioTranscription:{},outputAudioTranscription:{},sessionResumption:{},systemInstruction:{parts:[{text:vp.systemInstruction||`You are NEO, an enterprise voice assistant. Greet ${first} naturally. Start in the ${displayDept} department context. You can search all knowledge the current user is authorized to access, and you may bridge to other departments when that information is authorized. Keep answers concise and actionable.`}]},tools:[{googleSearch:{}},{functionDeclarations:decl}]}}));await startAudio();};
      ws.onmessage=async ev=>{let m;try{m=JSON.parse(ev.data)}catch{return}const c=m.serverContent||m.server_content;if(c?.interrupted)stopPlayback();if(c?.inputTranscription?.text)append('You',c.inputTranscription.text);if(c?.outputTranscription?.text)append('NEO',c.outputTranscription.text);if(c?.modelTurn?.parts)for(const part of c.modelTurn.parts)if(part.inlineData?.data)play(part.inlineData.data);const tc=m.toolCall||c?.toolCall;if(tc?.functionCalls)for(const call of tc.functionCalls){const result=await tool(call.name,call.args||{});ws.send(JSON.stringify({toolResponse:{functionResponses:[{name:call.name,id:call.id,response:{result}}]}}))}};
      ws.onerror=()=>setStatus('Voice connection error',false);
      ws.onclose=()=>{stopAudio();stopPlayback();if(!closed&&!reconnecting){reconnecting=true;setStatus('Reconnecting…',true);setTimeout(()=>{reconnecting=false;connect().catch(()=>{try{startBrowserFallback()}catch{setStatus('Live voice unavailable',false)}})},900)}else if(closed)setStatus('Conversation ended',false)};
    }
    async function begin(){
      if(!closed)return;closed=false;start.disabled=true;mute.disabled=false;stop.disabled=false;panel.classList.add('active');setStatus('Starting…',true);
      try{await connect();}catch(e){try{startBrowserFallback();setStatus('Listening…',true)}catch(f){closed=true;start.disabled=false;mute.disabled=true;stop.disabled=true;setStatus(f.message||e.message,false)}}
    }
    function end(){closed=true;try{ws?.close()}catch{}stopAudio();stopPlayback();try{browserRec?.stop()}catch{}browserRec=null;browserMode=false;speechSynthesis?.cancel();start.disabled=false;mute.disabled=true;stop.disabled=true;setStatus('Tap the microphone and talk naturally',false)}
    function sayGreeting(){tx.textContent='';append('NEO',greeting);if(window.speechSynthesis){try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(greeting);u.rate=1.04;speechSynthesis.speak(u);sessionStorage.setItem('neo_greeted_'+String(pageDept||displayDept),'1')}catch{}}}
    function open(){panel.hidden=false;panel.classList.add('open');sayGreeting();}
    orb.addEventListener('click',open);close.addEventListener('click',()=>{panel.hidden=true;end()});start.addEventListener('click',begin);stop.addEventListener('click',end);mute.addEventListener('click',()=>{muted=!muted;stopPlayback();mute.textContent=muted?'Resume':'Mute';setStatus(muted?'Muted':'Listening…',!muted)});document.addEventListener('neo:open-voice',open);
    panel.hidden=true;
    if(document.body.classList.contains('department-page') && !sessionStorage.getItem('neo_greeted_'+String(pageDept||displayDept))){setTimeout(()=>{try{sayGreeting()}catch{}},700);}
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
