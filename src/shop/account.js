import {initShopNavigation} from '../ui/storefront.js';
import {api,errorMessage} from './api.js';
import {isUUID,cents,nicknameValue} from './schema.js';
import {$,escape} from '../ui/render.js';
import {money} from '../data/catalog.js';
import {enterPage} from '../ui/motion.js';
const steps=['PENDENTE','PROCESSANDO','ENVIADO','ENTREGUE'];
let user=null,cursor=null,nextCursor=null,cursors=[],busy=false,listVersion=0,detailVersion=0;
let focusIntent=0;
for(const type of ['pointerdown','keydown','focusin'])document.addEventListener(type,()=>{focusIntent++;},true);
const status=text=>{$('#account-status').textContent=text;};
const greeting=()=>user.nickname==null?`Nome de usuário: <strong>${escape(user.login)}</strong>`:`Olá, <strong>${escape(user.nickname)}</strong>.`;
function sessionMarkup(){
  if(user)return `<div class="shop-session"><p id="account-greeting" tabindex="-1">${greeting()}</p><button class="btn btn--secondary" id="account-logout">Sair da conta</button></div>
    <form class="shop-form" data-profile novalidate autocomplete="off"><h2>Seu apelido</h2>
    <p>Nome de usuário: <strong>${escape(user.login)}</strong>. Alterar o apelido não muda seu acesso.</p>
    <label for="profile-nickname">Apelido</label><input id="profile-nickname" name="nickname" value="${escape(user.nickname??'')}" maxlength="120" required autocomplete="off" aria-describedby="profile-help profile-error">
    <p class="small-note" id="profile-help">Como a loja chama você. Use 2–60 caracteres; espaços, acentos e maiúsculas são preservados. Use um apelido fictício.</p>
    <p id="profile-error" class="detail-error" role="status"></p><button type="submit" class="btn btn--secondary">Salvar apelido</button></form>`;
  return `<div class="shop-auth-grid">${[['login','Entrar'],['register','Criar conta de teste']].map(([action,label])=>`<form class="shop-form" data-auth="${action}" novalidate autocomplete="off">
    <h2>${label}</h2><label for="${action}-login">Nome de usuário</label><input id="${action}-login" name="login" autocomplete="off" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]+" aria-describedby="${action}-help ${action}-error">
    ${action==='register'?`<label for="register-nickname">Apelido</label><input id="register-nickname" name="nickname" required maxlength="120" autocomplete="off" aria-describedby="register-nickname-help register-error"><p class="small-note" id="register-nickname-help">Como a loja chama você. Use 2–60 caracteres, com espaços, acentos e maiúsculas. Escolha um apelido fictício; ele não é seu nome de usuário.</p>`:''}
    <label for="${action}-password">Senha exclusiva de teste</label><input id="${action}-password" type="password" name="password" autocomplete="off" required minlength="12" maxlength="256" aria-describedby="${action}-help ${action}-error">
    <p id="${action}-help" class="small-note">Nome de usuário: 3–32 letras ASCII, números, _ ou -, sem espaços; maiúsculas e minúsculas equivalem no acesso. Senha: pelo menos 12 caracteres; nunca reutilize uma senha real.</p>
    <p id="${action}-error" role="status" class="detail-error"></p><button class="btn btn--primary" type="submit">${label}</button></form>`).join('')}</div>`;
}
function totals(order){
  const fields=['subtotalCents','merchDiscountCents','shippingCents','shippingDiscountCents','totalCents'];
  if(!fields.every(k=>cents(order[k])))throw new Error('Valores da compra indisponíveis. Atualize a consulta.');
  return `<dl class="shop-totals"><div><dt>Mercadoria</dt><dd>${money(order.subtotalCents)}</dd></div><div><dt>Descontos nos itens</dt><dd>−${money(order.merchDiscountCents)}</dd></div><div><dt>${escape(order.shippingName)}</dt><dd>${money(order.shippingCents)}</dd></div><div><dt>Desconto no frete</dt><dd>−${money(order.shippingDiscountCents)}</dd></div><div><dt>Total fictício</dt><dd>${money(order.totalCents)}</dd></div></dl>`;
}
async function list(){
  const version=++listVersion;
  $('#account-orders').setAttribute('aria-busy','true');status('Consultando suas compras…');
  try{
    const data=await api.request('/me/pedidos?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
    if(version!==listVersion)return;
    if(!Array.isArray(data.items)||data.items.length>20||!(data.nextCursor===null||typeof data.nextCursor==='string'))throw new Error('Página de compras inválida.');
    nextCursor=data.nextCursor;
    $('#account-orders').innerHTML=`<h2>Minhas compras de teste</h2>${data.items.length?data.items.map(o=>{
      if(!isUUID(o.id)||!cents(o.totalCents)||!steps.includes(o.status))throw new Error('Compra inválida.');
      return `<article class="shop-order-row"><div><h3>Pedido ${escape(o.id)}</h3><p>${escape(o.status)} · ${money(o.totalCents)}</p></div><a class="text-button" href="/conta.html?pedido=${encodeURIComponent(o.id)}" data-order="${escape(o.id)}">Consultar compra</a></article>`;
    }).join(''):'<p>Nenhuma compra fictícia registrada nesta conta.</p>'}<div class="shop-inline"><button class="btn btn--secondary" data-orders-prev ${cursors.length?'':'disabled'}>Compras anteriores</button><button class="btn btn--secondary" data-orders-next ${nextCursor?'':'disabled'}>Próximas compras</button></div>`;
    status('Somente compras desta conta. Etapas e datas representam a demonstração.');
  }catch(e){if(version===listVersion)status(errorMessage(e));}
  finally{if(version===listVersion)$('#account-orders').setAttribute('aria-busy','false');}
}
async function detail(id,focus=false){
  if(!isUUID(id)){status('Identificador da compra inválido.');return;}
  const version=++detailVersion,intent=focusIntent;
  const target=$('#account-order-detail');target.setAttribute('aria-busy','true');status('Consultando compra…');
  try{
    const order=await api.request('/me/pedidos/'+encodeURIComponent(id));
    if(version!==detailVersion)return;
    if(order.id!==id||order.demo!==true||!steps.includes(order.status)||!Array.isArray(order.items)||!Array.isArray(order.statusHistory))throw new Error('Detalhe de compra inválido.');
    const summary=totals(order);
    target.innerHTML=`<h2 tabindex="-1" id="order-detail-title">Pedido ${escape(order.id)}</h2><p>Compra fictícia · ${escape(order.status)}. Nenhum envio ou pagamento real.</p>
      <dl class="shop-totals"><div><dt>Nome completo</dt><dd>${escape(order.recipientFullName??'Não informado')}</dd></div></dl>
      <ol class="shop-timeline">${steps.map(step=>{const event=order.statusHistory.find(e=>e.status===step);return `<li class="${event?'is-recorded':''}"><strong>${step}</strong><span>${event?escape(new Date(event.createdAt).toLocaleString('pt-BR')):'Ainda não registrado'}</span></li>`;}).join('')}</ol>
      ${order.items.map(i=>`<article class="shop-order-row"><div><h3>${escape(i.name)}</h3><p>${escape(i.variant||'')} · Quantidade ${escape(i.quantity)}</p><p>Desconto nos itens ${money(i.discountCents)}</p></div><strong>${money(i.totalCents)}</strong></article>`).join('')}${summary}
      <ul>${(order.appliedCoupons||[]).map(c=>`<li>${escape(c.code)} · itens −${money(c.merchDiscountCents)} · frete −${money(c.shippingDiscountCents)}</li>`).join('')}</ul>
      <p class="small-note">Registro da compra ${escape(order.purchase?.id||'')} · ${escape(order.purchase?.paymentMethod||'')} · SIMULADO</p>`;
    if(focus&&intent===focusIntent)$('#order-detail-title').focus({preventScroll:true});status('Detalhe atualizado desta conta.');
  }catch(e){if(version===detailVersion){target.innerHTML='';status(errorMessage(e));}}
  finally{if(version===detailVersion)target.setAttribute('aria-busy','false');}
}
async function refresh(){
  if(busy)return;busy=true;$('#account-retry').disabled=true;
  listVersion++;detailVersion++;$('#account-orders').innerHTML='';$('#account-order-detail').innerHTML='';
  try{
    const session=await api.getSession(true);
    if(session.user&&session.user.role!=='CUSTOMER')throw new Error('Use a origem da loja para uma conta de cliente.');
    user=session.user;$('#account-session').innerHTML=sessionMarkup();
    document.querySelectorAll('[data-account-label]').forEach(n=>n.textContent=user?'Minha conta':'Entrar');
    if(user){await list();const id=new URLSearchParams(location.search).get('pedido');if(id)await detail(id);}
    else{$('#account-orders').innerHTML='';$('#account-order-detail').innerHTML='';status('Entre ou crie uma conta de teste. Sua sacola permanece neste navegador.');}
  }catch(e){status(errorMessage(e));}
  finally{busy=false;$('#account-retry').disabled=false;}
}
document.addEventListener('submit',async event=>{
  const profile=event.target.closest('[data-profile]');
  if(profile){
    event.preventDefault();if(busy)return;
    const input=profile.elements.nickname,error=profile.querySelector('.detail-error'),button=profile.querySelector('[type=submit]');
    input.removeAttribute('aria-invalid');error.textContent='';
    let nickname;try{nickname=nicknameValue(input.value);}catch(e){error.textContent=e.message;input.setAttribute('aria-invalid','true');input.focus();return;}
    busy=true;button.disabled=true;profile.setAttribute('aria-busy','true');status('Salvando seu apelido…');
    try{const data=await api.updateProfile(nickname);user=data.user;input.value=user.nickname;$('#account-greeting').innerHTML=greeting();status('Apelido atualizado. Seu nome de usuário e suas compras não mudaram.');}
    catch(e){error.textContent=e.fields?.nickname||errorMessage(e);input.setAttribute('aria-invalid','true');status('Apelido não atualizado. Seu acesso continua o mesmo.');}
    finally{busy=false;button.disabled=false;profile.setAttribute('aria-busy','false');}return;
  }
  const form=event.target.closest('[data-auth]');if(!form)return;event.preventDefault();if(busy)return;
  const login=form.elements.login,password=form.elements.password,nickname=form.elements.nickname,error=form.querySelector('.detail-error');
  login.removeAttribute('aria-invalid');password.removeAttribute('aria-invalid');error.textContent='';
  let first,name;
  if(nickname){nickname.removeAttribute('aria-invalid');try{name=nicknameValue(nickname.value);}catch(e){nickname.setAttribute('aria-invalid','true');error.textContent='Apelido: '+e.message;first=nickname;}}
  if(!/^[A-Za-z0-9_-]{3,32}$/.test(login.value)){login.setAttribute('aria-invalid','true');first=login;}
  if(password.value.length<12||new TextEncoder().encode(password.value).length>256){password.setAttribute('aria-invalid','true');first??=password;}
  if(first){error.textContent=error.textContent||'Revise o nome de usuário (3–32 caracteres ASCII) e a senha exclusiva de teste (12+ caracteres, até 256 bytes).';first.focus();return;}
  busy=true;const button=form.querySelector('[type=submit]');button.disabled=true;status('Validando acesso de teste…');
  const intent=focusIntent;
  try{await api.auth(form.dataset.auth,login.value,password.value,name);password.value='';busy=false;await refresh();if(intent===focusIntent)$('#account-greeting').focus({preventScroll:true});}
  catch(e){password.value='';error.textContent=e.fields?Object.values(e.fields).join(' '):errorMessage(e);status('Acesso não concluído. Sua sacola foi mantida.');}
  finally{busy=false;button.disabled=false;}
});
document.addEventListener('click',async event=>{
  if(event.target.closest('#account-logout')){
    if(busy)return;busy=true;listVersion++;detailVersion++;
    try{await api.logout();user=null;cursor=null;cursors=[];$('#account-orders').innerHTML='';$('#account-order-detail').innerHTML='';busy=false;await refresh();}catch(e){status(errorMessage(e));}finally{busy=false;}return;
  }
  const order=event.target.closest('[data-order]');
   if(order){event.preventDefault();history.pushState(null,'',order.href);await detail(order.dataset.order,true);}
  if($('#account-orders').getAttribute('aria-busy')==='true')return;
  if(event.target.closest('[data-orders-next]')&&nextCursor){cursors.push(cursor);cursor=nextCursor;list();}
  if(event.target.closest('[data-orders-prev]')&&cursors.length){cursor=cursors.pop();list();}
});
window.addEventListener('popstate',()=>{const id=new URLSearchParams(location.search).get('pedido');if(id&&user)detail(id,true);else $('#account-order-detail').innerHTML='';});
$('#account-retry').addEventListener('click',refresh);
initShopNavigation();enterPage();document.documentElement.dataset.ready='true';refresh();
