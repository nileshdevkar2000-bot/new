(function(){
 const modes=['theme-aurora','theme-light','theme-graphite'];
 function applyMode(mode){document.body.classList.remove(...modes);document.body.classList.add(mode);localStorage.setItem('neo.theme',mode);document.querySelectorAll('[data-theme-switch]').forEach(b=>b.title='Theme: '+mode.replace('theme-',''));}
 document.addEventListener('DOMContentLoaded',()=>{const saved=localStorage.getItem('neo.theme');applyMode(saved|| (document.body.classList.contains('theme-light')?'theme-light':'theme-aurora'));document.querySelectorAll('[data-theme-switch]').forEach(b=>b.addEventListener('click',()=>{const cur=document.body.className.match(/theme-[\w-]+/)?.[0]||'theme-aurora';applyMode(modes[(modes.indexOf(cur)+1)%modes.length]);}));document.querySelectorAll('.mobile-toggle').forEach(b=>b.addEventListener('click',()=>document.querySelector('.main-nav')?.classList.toggle('mobile-open')));});
})();
