import {closeDialog} from './dialogs.js';
import {reducedMotion,onMotionChange} from './motion.js';
const sections=new Set(['#colecao','#sebo','#essencia','#encomendas']);
const ENTRY_KEY='flor-de-lotus:section-entry:v1';

// Only navbar section links opt in. Real hrefs remain the fallback and route contract.
// Native smooth scrolling was measured to jump under this Windows reduced setting,
// even for consented Full; this small, bounded RAF scroll is site-preference aware.
export function initSectionNavigation() {
  let intent=0,frame,job;
  function cancel() {
    intent++;cancelAnimationFrame(frame);frame=undefined;job=undefined;
  }
  function rememberEntry(hash) {
    // A one-use section enum, never cart data, user data or a motion preference.
    try {
      sessionStorage.removeItem(ENTRY_KEY);
      sessionStorage.setItem(ENTRY_KEY,hash);
    }catch{ /* Native href/fragment navigation remains usable without storage. */ }
  }
  window.addEventListener('pageshow',()=>{try{sessionStorage.removeItem(ENTRY_KEY);}catch{}});
  function destination(target) {
    const header=document.querySelector('.site-header')?.getBoundingClientRect().height||0;
    return Math.max(0,Math.min(document.documentElement.scrollHeight-innerHeight,target.getBoundingClientRect().top+scrollY-header-12));
  }
  function focus(target) {
    const heading=target.querySelector('h2,h3')||target;
    heading.tabIndex=-1;heading.focus({preventScroll:true});
  }
  function go(target,request) {
    if(request!==intent)return;
    const start=scrollY,duration=Math.min(700,Math.max(360,Math.abs(destination(target)-start)*.2));
    if(reducedMotion()||typeof requestAnimationFrame!=='function'||Math.abs(destination(target)-start)<1) {
      scrollTo({top:destination(target),behavior:'instant'});focus(target);return;
    }
    job={target,request};
    const began=performance.now();
    function step(now) {
      if(request!==intent)return;
      const t=Math.min(1,(now-began)/duration),ease=t*t*(3-2*t);
      scrollTo({top:start+(destination(target)-start)*ease,behavior:'instant'});
      if(t<1)frame=requestAnimationFrame(step);
      else {job=undefined;frame=undefined;focus(target);}
    }
    frame=requestAnimationFrame(step);
  }
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[data-section-link]');
    if(!link||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||link.target==='_blank')return;
    const url=new URL(link.href,location.href);
    if(url.origin!==location.origin||!sections.has(url.hash))return;
    const home=document.body.dataset.page==='home',menu=document.querySelector('#menu-dialog[open]');
    if(!home&&!menu){rememberEntry(url.hash);return;} // href performs the real MPA navigation
    const target=home?document.getElementById(url.hash.slice(1)):null;
    if(home&&!target)return;
    event.preventDefault();cancel();const request=intent;
    const arrive=()=>{
      if(request!==intent)return;
      if(!home){rememberEntry(url.hash);location.assign(url.href);return;}
      if(location.hash!==url.hash)history.pushState(history.state,'',location.pathname+location.search+url.hash);
      go(target,request);
    };
    if(menu)closeDialog(menu,false).then(closed=>{if(closed)arrive();});
    else arrive();
  });
  for(const type of ['wheel','touchstart','pointerdown'])window.addEventListener(type,cancel,{passive:true});
  window.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' ','Tab','Escape'].includes(event.key))cancel();});
  document.addEventListener('focusin',()=>{if(job)cancel();});
  window.addEventListener('popstate',cancel);
  window.addEventListener('pagehide',cancel);
  onMotionChange(reduced=>{
    if(reduced&&job){const target=job.target;cancel();scrollTo({top:destination(target),behavior:'instant'});focus(target);}
  });
  const root=document.documentElement,entry=root.dataset.sectionEntry;
  const loaded=document.readyState==='complete'?Promise.resolve():new Promise(resolve=>window.addEventListener('load',resolve,{once:true}));
  const settled=Promise.all([loaded,document.fonts?.ready||Promise.resolve()]);
  if(entry&&sections.has(entry)){
    // Native fragment anchors can both scroll AND clear a heading's focus after
    // fonts.ready. Do not expose the hash until load has finished without it.
    root.dataset.sectionEntryClaimed='true';
    const target=document.getElementById(entry.slice(1)),request=++intent;
    settled.then(()=>requestAnimationFrame(()=>{
      delete root.dataset.sectionEntry;
      delete root.dataset.sectionEntryClaimed;
      if(!location.hash)history.replaceState(history.state,'',location.pathname+location.search+entry);
      if(target)go(target,request);
    }));
  }else if(root.dataset.sectionNativeEntry&&sections.has(root.dataset.sectionNativeEntry)){
    // Reduced explicit entry keeps native hash/position, with one intentional
    // focus after native processing. Direct/reloaded fragments never opt in.
    const hash=root.dataset.sectionNativeEntry,request=++intent;
    delete root.dataset.sectionNativeEntry;
    settled.then(()=>requestAnimationFrame(()=>{
      const target=document.getElementById(hash.slice(1));
      if(request===intent&&location.hash===hash&&target)focus(target);
    }));
  }
}
