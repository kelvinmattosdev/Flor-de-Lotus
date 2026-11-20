import {MOTION_KEY, motionChoice, effectiveMotion} from '../domain/motion-preference.js';
const media=window.matchMedia('(prefers-reduced-motion: reduce)');
const listeners=new Set();
let choice=motionChoice(document.documentElement.dataset.motionChoice);
export const reducedMotion=()=>document.documentElement.dataset.motionEffective==='reduced';
export const onMotionChange=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
function apply(next) {
  choice=motionChoice(next);
  const root=document.documentElement;
  root.dataset.motionChoice=choice;
  root.dataset.motionEffective=effectiveMotion(choice,media.matches);
  for(const fn of listeners)fn(reducedMotion());
}
media.addEventListener?.('change',()=>apply(choice));
window.addEventListener('storage',event=>{
  let storage;
  try{storage=window.localStorage;}catch{return;}
  if(event.storageArea===storage && (event.key===MOTION_KEY||event.key===null))apply(event.newValue);
});
window.addEventListener('pageshow',()=>{try{apply(window.localStorage.getItem(MOTION_KEY));}catch{apply(choice);}});
// U15 removes the temporary control, not previously consented Full or legacy Reduced.
apply(choice);
