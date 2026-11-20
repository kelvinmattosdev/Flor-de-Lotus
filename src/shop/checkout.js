import {quoteDTO,receiptDTO,recipientName} from './schema.js';
export const normalizeCoupon=s=>String(s).trim().toUpperCase();
export function couponCodes(values){
  const codes=[...new Set(values.map(normalizeCoupon))];
  if(codes.length>5||codes.some(s=>!/^[A-Z0-9-]{2,32}$/.test(s)))throw new Error('Use até 5 códigos distintos, com 2 a 32 letras, números ou hífens.');
  return codes;
}
// Injectable and DOM-free. Uncertain submissions keep the EXACT quote/key/account
// in memory; edits cannot silently replace an unresolved confirmation.
export function createCheckout({request,session,random=()=>crypto.randomUUID(),now=()=>Date.now()}){
  let revision=0,quote=null,attempt=null,busy=false,recovery=null;
  const state=()=>({quote,attempt,busy,recovery});
  function invalidate(){revision++;quote=null;}
  async function preview(input){
    if(attempt)throw new Error('Resolva a confirmação pendente antes de criar outra prévia.');
    if(recovery)throw new Error('Consulte suas compras antes de solicitar outra revisão.');
    const version=++revision;quote=null;
    const recipientFullName=recipientName(input.recipientFullName);
    const s=await session(true);
    if(s.user?.role!=='CUSTOMER')throw Object.assign(new Error('Entre na sua conta de teste para revisar a compra.'),{status:401});
    if(version!==revision)return null;
    const data=quoteDTO(await request('/checkout/quote',{method:'POST',body:{...input,recipientFullName}}));
    if(version!==revision)return null;
    quote={...data,accountId:s.user.id,recipientFullName};return quote;
  }
  async function confirm(){
    if(busy)return null;
    busy=true;
    try {
    const s=await session(true);
    if(!s.user||s.user.role!=='CUSTOMER'){invalidate();throw Object.assign(new Error('Entre novamente na conta desta confirmação.'),{status:401});}
    if(attempt&&attempt.accountId!==s.user.id)throw new Error('A confirmação pendente pertence a outra conta de teste. Entre na conta original.');
    if(!attempt){
      if(quote&&quote.accountId!==s.user.id){invalidate();throw Object.assign(new Error('A conta mudou. Informe o nome fictício e revise novamente.'),{code:'ACCOUNT_CHANGED'});}
      if(!quote||Date.parse(quote.expiresAt)<=now()){invalidate();throw new Error('A prévia expirou. Solicite uma nova revisão.');}
      attempt={quoteId:quote.quoteId,key:random(),accountId:s.user.id,recipientFullName:quote.recipientFullName,quote};quote=null;
    }
      const result=receiptDTO(await request('/pedidos',{method:'POST',headers:{'Idempotency-Key':attempt.key},body:{quoteId:attempt.quoteId,recipientFullName:attempt.recipientFullName}}),attempt.quote);
      attempt=null;return result;
    }catch(error){
      // 409 is a definitive rejection, unlike a network/5xx/invalid receipt.
      if(error.status===409){attempt=null;invalidate();if(['QUOTE_CONSUMED','IDEMPOTENCY_CONFLICT'].includes(error.code))recovery='purchases';}
      throw error;
    }finally{busy=false;}
  }
  return{state,invalidate,preview,confirm,acknowledgePurchases:()=>{recovery=null;}};
}
