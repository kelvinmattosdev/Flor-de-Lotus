import {panelMotion, cancelMotion, onMotionChange} from './motion.js';
const origins=new WeakMap(), states=new WeakMap();
let previousOverflow='', locked=false, intent=0;
function state(dialog) {
  if(!states.has(dialog))states.set(dialog,{phase:'closed',timer:undefined,finish:null,resolve:null});
  return states.get(dialog);
}
function syncMenuState(dialog) {
  if(dialog.id==='menu-dialog')document.querySelector('#menu-toggle')?.setAttribute('aria-expanded',String(dialog.open));
}
function unlock() {
  if(!document.querySelector('dialog[open]')&&locked){document.body.style.overflow=previousOverflow;locked=false;}
}
function cancelPhase(dialog) {
  const s=state(dialog);
  clearTimeout(s.timer);s.finish=null;
  cancelMotion(dialog);
  s.resolve?.(false);s.resolve=null;
}
function show(dialog,origin) {
  const s=state(dialog);
  const from=dialog.open?getComputedStyle(dialog).transform:undefined;
  cancelPhase(dialog);
  if(!locked){previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';locked=true;}
  origins.set(dialog,origin);
  if(!dialog.open)dialog.showModal();
  syncMenuState(dialog);
  s.phase='opening';dialog.dataset.dialogPhase='opening';
  (dialog.querySelector('[data-initial-focus]')||dialog.querySelector('button, a, input')||dialog).focus({preventScroll:true});
  dialog.scrollTop=0;
  const animation=panelMotion(dialog,false,from);
  const ready=()=>{if(s.phase==='opening'){s.phase='open';dialog.dataset.dialogPhase='open';}};
  if(animation){animation.finished.then(ready).catch(()=>{});s.timer=setTimeout(ready,420);}else ready();
}
function beginClose(dialog,restore,onClosed) {
  if(!dialog?.open)return Promise.resolve(true);
  const s=state(dialog);
  if(s.phase==='closing')return s.promise;
  const from=getComputedStyle(dialog).transform;
  cancelPhase(dialog);
  s.phase='closing';dialog.dataset.dialogPhase='closing';
  s.promise=new Promise(resolve=>{s.resolve=resolve;});
  const finish=()=>{
    if(s.phase!=='closing')return;
    clearTimeout(s.timer);s.finish=null;
    cancelMotion(dialog);
    s.phase='closed';dialog.dataset.dialogPhase='closed';
    dialog.close();syncMenuState(dialog);
    onClosed?.(); // replacement opens synchronously before releasing the one body lock
    unlock();
    if(restore&&!document.querySelector('dialog[open]')&&origins.get(dialog)?.isConnected)origins.get(dialog).focus({preventScroll:true});
    s.resolve?.(true);s.resolve=null;
  };
  s.finish=finish;
  const animation=panelMotion(dialog,true,from);
  if(animation){animation.finished.then(finish).catch(()=>{});s.timer=setTimeout(finish,360);}
  else finish();
  return s.promise;
}
export function openDialog(dialog,origin=document.activeElement) {
  const request=++intent,current=document.querySelector('dialog[open]');
  const returnTarget=current?origins.get(current):origin;
  if(current&&current!==dialog) {
    // Repeated replacement requests supersede the previous finite exit, never its body lock.
    if(state(current).phase==='closing'){cancelPhase(current);state(current).phase='open';}
    beginClose(current,false,()=>{if(request===intent)show(dialog,returnTarget);});
  }else show(dialog,current?returnTarget:origin);
}
export function closeDialog(dialog,restore=true) {
  ++intent;
  return beginClose(dialog,restore);
}
onMotionChange(reduced=>{
  if(!reduced)return;
  document.querySelectorAll('dialog[open]').forEach(dialog=>{
    const s=state(dialog);
    if(s.phase==='closing')s.finish?.();
    else {cancelPhase(dialog);s.phase='open';dialog.dataset.dialogPhase='open';}
  });
});
export function initDialogs() {
  document.querySelectorAll('dialog:not([data-dialog-wired])').forEach(dialog=>{
    dialog.dataset.dialogWired='true';
    dialog.addEventListener('close',()=>{
      // A queued native event can belong to an earlier opening: current live state wins.
      if(!dialog.open){cancelPhase(dialog);state(dialog).phase='closed';dialog.dataset.dialogPhase='closed';}
      syncMenuState(dialog);unlock();
    });
    dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog(dialog);});
    dialog.addEventListener('click',event=>{
      const box=dialog.getBoundingClientRect();
      if(event.target===dialog&&(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom))closeDialog(dialog);
      if(event.target.closest('[data-close]'))closeDialog(dialog);
    });
    dialog.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const controls=[...dialog.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(el=>el.getClientRects().length&&!el.closest('[hidden]'));
      if(!controls.length){event.preventDefault();return;}
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!controls.includes(document.activeElement))){event.preventDefault();first.focus();}
    });
  });
}
