import {api,errorMessage} from './api.js';
import {createCheckout,couponCodes} from './checkout.js';
import {loadCart,settleCart,saveCart} from './cart.js';
import {money,shippingOptions} from '../data/catalog.js';
import {recipientName} from './schema.js';
import {$,escape,closeButton,icon} from '../ui/render.js';
export const coupons={codes:[]};
const reasons={UNAVAILABLE:'Indisponível',SCOPE_MISMATCH:'Não se aplica a estes itens',MINIMUM_NOT_MET:'Mínimo elegível não atingido',INCOMPATIBLE:'Incompatível com os demais',NO_BENEFIT:'Sem benefício nesta compra',NOT_SELECTED:'Outra combinação oferece maior economia'};
export function couponForm(prefix='cart'){
  return `<section class="shop-coupons" aria-labelledby="${prefix}-coupons-title"><h3 id="${prefix}-coupons-title">Cupons de demonstração</h3><form data-coupon-form><label for="${prefix}-coupon-code">Código do cupom</label><div class="shop-inline"><input id="${prefix}-coupon-code" name="coupon" maxlength="32" autocomplete="off" aria-describedby="${prefix}-coupon-help"><button class="btn btn--secondary" type="submit">Adicionar cupom</button></div><p id="${prefix}-coupon-help" class="small-note">Até 5 códigos. A loja verifica escopo, mínimo e combinação na prévia.</p></form><ul class="shop-coupon-list">${coupons.codes.map(code=>`<li>${escape(code)} <button type="button" data-remove-coupon="${escape(code)}" aria-label="Remover cupom ${escape(code)}">Remover</button></li>`).join('')}</ul><p data-coupon-status role="status"></p></section>`;
}
export function handleCoupons(root,onChange,isLocked=()=>false){
  root.addEventListener('submit',event=>{
    if(!event.target.matches('[data-coupon-form]'))return;event.preventDefault();
    const status=root.querySelector('[data-coupon-status]');
    try{
      if(isLocked())throw new Error('Resolva a confirmação pendente antes de alterar cupons.');
      coupons.codes=couponCodes([...coupons.codes,event.target.elements.coupon.value]);onChange();
    }catch(e){status.textContent=e.message;}
  });
  root.addEventListener('click',event=>{
    const b=event.target.closest('[data-remove-coupon]');if(!b)return;
    if(isLocked()){root.querySelector('[data-coupon-status]').textContent='Resolva a confirmação pendente antes de alterar cupons.';return;}
    coupons.codes=coupons.codes.filter(c=>c!==b.dataset.removeCoupon);onChange();
  });
}
export function quoteMarkup(q){
  return `<h3>Prévia calculada pela loja</h3>${q.items.map(i=>`<div class="checkout-summary-item"><div><p>${escape(i.name)}</p><small>${escape(i.variant)} · Quantidade ${i.quantity} · Unitário ${money(i.unitPriceCents)}</small><p>Desconto: ${money(i.discountCents)}</p></div><strong>${money(i.totalCents)}</strong></div>`).join('')}
    <div class="summary-line"><span>Mercadoria</span><strong>${money(q.subtotalCents)}</strong></div>
    <div class="summary-line"><span>Descontos nos itens</span><strong>− ${money(q.merchDiscountCents)}</strong></div>
    <div class="summary-line"><span>${escape(q.shippingName||'Entrega fictícia')}</span><strong>${money(q.shippingCents)}</strong></div>
    <div class="summary-line"><span>Desconto no frete</span><strong>− ${money(q.shippingDiscountCents)}</strong></div>
    <div class="summary-line total"><span>Total demonstrativo</span><strong>${money(q.totalCents)}</strong></div>
    <ul>${q.appliedCoupons.map(c=>`<li>${escape(c.code)} aplicado: itens −${money(c.merchDiscountCents)}, frete −${money(c.shippingDiscountCents)}</li>`).join('')}${q.rejectedCoupons.map(c=>`<li>${escape(c.code)} não aplicado: ${escape(reasons[c.reason]||'Revise as regras do cupom.')}</li>`).join('')}</ul>
    <p class="small-note">Prévia válida até ${escape(new Date(q.expiresAt).toLocaleTimeString('pt-BR'))}. Confirmar revalida preços e regras no servidor.</p>
    <button class="btn btn--primary" id="confirm-simulation">Confirmar pedido fictício</button>`;
}
// This is the actual success renderer, exercised by the historical scroll test.
export function renderReceipt({receipt,changed,checkoutDialog,content,title,hideToast,focus=true}){
  content.innerHTML=`<div class="dialog-header"><span class="eyebrow">Flor de Lotus · demonstração</span>${closeButton('Fechar conclusão da simulação')}</div>
    <div class="success-view"><div class="success-symbol">${icon('check')}</div><p class="eyebrow">Registro local confirmado</p><h2 id="checkout-title" tabindex="-1">Simulação<br><em>concluída.</em></h2>
    <p>Pedido fictício <strong>${escape(receipt.orderId)}</strong></p><p>Status inicial: PENDENTE · Total ${money(receipt.totalCents)}</p>
    <p>${changed?'Sua sacola mudou durante a confirmação e foi preservada por inteiro. Confira os itens antes de uma próxima compra.':'Os itens desta sacola foram registrados e a sacola foi esvaziada.'}</p>
    <p>Nenhuma cobrança, email ou entrega real. O registro fica apenas nesta loja de demonstração.</p>
    <a class="btn btn--secondary" href="/conta.html?pedido=${encodeURIComponent(receipt.orderId)}">Consultar minha compra</a><button class="btn btn--primary" data-return-collection>Voltar à coleção ${icon('arrow')}</button></div>`;
  hideToast();checkoutDialog.scrollTop=0;if(focus)title().focus({preventScroll:true});
}
export function createCheckoutView({storage,getCart,readCart=()=>storage?loadCart(storage):getCart(),setCart,updateCart,validateCart,announce,focusReceipt}){
  const dialog=$('#checkout-dialog'),content=$('#checkout-content');
  const model=createCheckout({request:api.request,session:api.getSession});
  let shipping='correios',payment='PIX_SIMULADO',quotedCart=[],message='',epoch=0,loading=false,submission=false;
  let recipientDraft='',recipientError='',account;
  const isLocked=()=>submission||Boolean(model.state().attempt);
  function summaryMarkup(){
    const {quote:q,attempt:pending,recovery}=model.state();
    return `<p id="checkout-status" role="status">${escape(message)}</p>${recovery?`<p>Esta confirmação pode já ter uma compra registrada. Consulte Compras antes de solicitar outra prévia.</p><a class="btn btn--secondary" href="/conta.html">Consultar minhas compras</a><button class="text-button" id="acknowledge-purchases">Já consultei Compras; revisar novamente</button>`:pending?`<p>Resposta anterior incerta. Retente a mesma confirmação antes de iniciar outra. A sacola não foi apagada.</p><p>Nome completo revisado: <strong>${escape(pending.recipientFullName)}</strong></p><button id="confirm-simulation" class="btn btn--primary" ${submission?'disabled':''}>${submission?'Confirmando…':'Retentar mesma confirmação'}</button>`:q?`<p>Nome completo revisado: <strong>${escape(q.recipientFullName)}</strong></p>${quoteMarkup(q)}`:`<p>Revise os valores no servidor antes de confirmar. Alterações de nome, itens, frete, pagamento ou cupons exigem nova prévia.</p><button id="review-order" class="btn btn--primary" ${loading?'disabled':''}>${loading?'Consultando loja…':'Revisar valores e cupons'}</button>`}
      <p class="small-note">Retry mantido só em memória nesta aba. Antes de recarregar/sair com resposta incerta, consulte suas compras; não envie outra confirmação sem verificar o histórico.</p>`;
  }
  function renderSummary(){
    $('#checkout-summary').innerHTML=summaryMarkup();
    const button=$('#confirm-simulation');
    if(button){
      button.disabled=submission;
      button.setAttribute('aria-busy',String(submission));
      button.setAttribute('aria-describedby','checkout-status');
      if(submission)button.textContent='Confirmando…';
    }
  }
  function render(){
    content.innerHTML=`<div class="dialog-header"><div><p class="eyebrow">Compra demonstrativa</p><h2 id="checkout-title" tabindex="-1" data-initial-focus>Uma última olhada.</h2></div>${closeButton('Fechar simulação')}</div>
      <div class="checkout-body"><div><button class="checkout-back" id="back-to-cart">${icon('back')} Voltar à sacola</button>
      <p class="demo-notice">Pedido fictício persistido na sua conta. Use somente apelido e senha de teste. Não há cobrança, envio ou email.</p>
      <p><a href="/conta.html?voltar=checkout">Entrar ou criar conta de teste</a></p>
      <fieldset class="checkout-section shop-form checkout-recipient" ${isLocked()?'disabled':''}><legend>Nome no pedido fictício</legend>
      <label for="checkout-recipient">Nome completo</label><input id="checkout-recipient" name="recipientFullName" type="text" autocomplete="off" maxlength="240" required value="${escape(recipientDraft)}" aria-describedby="checkout-recipient-help checkout-recipient-error" ${recipientError?'aria-invalid="true"':''}>
      <p class="small-note" id="checkout-recipient-help">Use um nome fictício de demonstração, com 2–120 caracteres e pelo menos uma letra. Espaços, acentos, apóstrofos, hífens e pontos são aceitos. Este nome fica só no detalhe privado do pedido; não é seu apelido nem seu nome de usuário.</p>
      <p id="checkout-recipient-error" class="detail-error" role="status">${escape(recipientError)}</p></fieldset>
      <fieldset class="checkout-section" ${isLocked()?'disabled':''}><legend>Entrega fictícia</legend><div class="delivery-choices">${shippingOptions.map(s=>`<label class="option"><input type="radio" name="shipping" value="${s.id}" ${shipping===s.id?'checked':''}><span class="option-body">${escape(s.name)}<small>${escape(s.days)} · exemplo</small></span><span class="option-price">${money(s.price)}</span></label>`).join('')}</div></fieldset>
      <fieldset class="checkout-section" ${isLocked()?'disabled':''}><legend>Pagamento simulado</legend><div class="payment-choices">${[['PIX_SIMULADO','Pix'],['CARTAO_SIMULADO','Cartão']].map(([id,label])=>`<label class="option"><input type="radio" name="payment" value="${id}" ${payment===id?'checked':''}><span>${label} · simulado</span></label>`).join('')}</div><p class="checkout-note">Não informe cartão, CPF, endereço ou CEP.</p></fieldset>
      ${couponForm('checkout')}</div><aside class="checkout-summary" id="checkout-summary" aria-label="Prévia demonstrativa"></aside></div>`;
    renderSummary();
  }
  async function preview(){
    if(isLocked()||loading)return;
    let recipientFullName;
    try{recipientFullName=recipientName(recipientDraft);recipientError='';}
    catch(e){recipientError=e.message;$('#checkout-recipient-error').textContent=recipientError;$('#checkout-recipient').setAttribute('aria-invalid','true');if(dialog.open)$('#checkout-recipient').focus({preventScroll:true});return;}
    const version=++epoch;loading=true;message='Validando sacola e consultando a loja…';render();
    try{
      const items=await validateCart();
      if(version!==epoch)return;
      if(!items.length)throw new Error('A sacola está vazia após a validação da loja.');
      const snapshot=items.map(i=>({...i}));
      const q=await model.preview({items:snapshot.map(i=>({productId:i.id,variant:i.variant,quantity:i.quantity})),shippingId:shipping,paymentMethod:payment,couponCodes:coupons.codes,recipientFullName});
      if(q&&version===epoch){quotedCart=snapshot;message='Confira a prévia antes de confirmar.';}
    }catch(e){if(version===epoch){message=errorMessage(e);recipientError=e.fields?.recipientFullName||'';}}
    finally{if(version===epoch){loading=false;render();}}
  }
  async function confirm(){
    if(submission)return;
    const actionFocused=dialog.open&&document.activeElement===$('#confirm-simulation');
    let focusMoved=false;
    const leaveAction=()=>{focusMoved=true;};
    document.addEventListener('pointerdown',leaveAction,true);
    document.addEventListener('keydown',leaveAction,true);
    dialog.addEventListener('focusin',leaveAction);
    submission=true;message='Confirmando registro local…';render();
    try{
      const receipt=await model.confirm();if(!receipt)return;
      const current=readCart();
      const settled=settleCart(current,quotedCart);setCart(settled.items);
      // Never write an older snapshot over a cart edited by another tab.
      if(!settled.changed)saveCart(storage,settled.items);
      updateCart(false);
      recipientDraft='';recipientError='';quotedCart=[];
      renderReceipt({receipt,changed:settled.changed,checkoutDialog:dialog,content,title:()=>$('#checkout-title'),hideToast:()=>{$('#toast').hidden=true;},focus:dialog.open&&!focusReceipt});
      if(dialog.open&&focusReceipt)focusReceipt();
      announce('Pedido fictício registrado. Status PENDENTE.');
    }catch(e){
      const restoreAction=actionFocused&&!focusMoved&&dialog.open&&dialog.isConnected&&
        (document.activeElement===document.body||document.activeElement===dialog);
      if(e.code==='ACCOUNT_CHANGED'&&!model.state().attempt)recipientDraft='';
      submission=false;message=model.state().recovery?'Consulte suas compras: esta confirmação pode já ter sido registrada.':errorMessage(e);recipientError=e.fields?.recipientFullName||'';render();
      if(restoreAction)($('#confirm-simulation')||$('#review-order'))?.focus({preventScroll:true});
    }
    finally{
      submission=false;
      document.removeEventListener('pointerdown',leaveAction,true);
      document.removeEventListener('keydown',leaveAction,true);
      dialog.removeEventListener('focusin',leaveAction);
      const button=$('#confirm-simulation');if(button)button.disabled=false;
    }
  }
  function invalidate(){
    model.invalidate();epoch++;loading=false;
    if(dialog.querySelector('.success-view'))return;
    message=isLocked()?'A sacola mudou. A confirmação em andamento será resolvida sem apagar a versão nova.':'A compra mudou. Solicite uma nova prévia.';
    if(dialog.open)render();
  }
  dialog.addEventListener('input',event=>{
    if(event.target.id!=='checkout-recipient'||isLocked())return;
    recipientDraft=event.target.value;recipientError='';model.invalidate();epoch++;loading=false;
    event.target.removeAttribute('aria-invalid');$('#checkout-recipient-error').textContent='';
    message='O nome mudou. Revise os valores novamente antes de confirmar.';
    // Do not rebuild the input while typing (including IME/selection/paste).
    renderSummary();
  });
  api.onSessionChange?.(s=>{
    const next=s.user?.id??null,changed=account!==undefined&&account!==next;account=next;
    if(changed&&!model.state().attempt){
      recipientDraft='';recipientError='';model.invalidate();epoch++;loading=false;
      if(dialog.open&&!dialog.querySelector('.success-view')){message='A conta mudou. Informe um nome fictício e revise novamente.';render();}
    }
  });
  dialog.addEventListener('change',event=>{
    if(isLocked())return;
    if(event.target.name==='shipping')shipping=event.target.value;
    else if(event.target.name==='payment')payment=event.target.value;
    else return;
    const name=event.target.name,value=event.target.value;
    invalidate();
    dialog.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`)?.focus({preventScroll:true});
  });
  dialog.addEventListener('click',event=>{
    if(event.target.closest('#review-order'))preview();
    if(event.target.closest('#confirm-simulation'))confirm();
    if(event.target.closest('#acknowledge-purchases')){model.acknowledgePurchases();message='Após conferir Compras, solicite uma nova revisão se necessário.';render();}
  });
  handleCoupons(dialog,()=>{invalidate();render();},isLocked);
  return{show:()=>{message=isLocked()?'Resolva a confirmação anterior nesta aba.':'';if(!isLocked())model.invalidate();render();api.getSession(true).catch(()=>{});},invalidate,isLocked};
}
