import {nicknameValue} from './schema.js';
// Same-origin only. Credentials/CSRF never leave memory or enter URLs/storage/logs.
export class ApiError extends Error {
  constructor(status,code,message,retryAfter=0,fields){super(message);this.status=status;this.code=code;this.retryAfter=retryAfter;this.fields=fields;}
}
export function createApi(fetcher=(...args)=>fetch(...args)) {
  let session=null, pending=null,identity;
  const listeners=new Set();
  function accept(data){
    session=data;const next=data.user?.id??null;
    if(next!==identity){identity=next;for(const fn of listeners)fn(data);}
    return data;
  }
  async function request(path,{method='GET',body,headers={},signal}={}) {
    if(!/^\/(?:session|auth\/(?:register|login|logout)|catalogo\/(?:categorias|anuncios(?:\/[A-Z0-9_-]+)?)|checkout\/quote|pedidos|me\/perfil|me\/pedidos(?:\/[a-f0-9-]+)?)(?:\?[^#]*)?$/.test(path))throw new Error('Rota de loja inválida.');
    let response;
    try {
      const timeout=AbortSignal.timeout(15000);
      response=await fetcher('/api/v1'+path,{method,credentials:'same-origin',redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout,
        headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers,
          ...(method!=='GET'?{'X-CSRF-Token':(await getSession()).csrfToken}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    }catch(error){if(error.name==='AbortError')throw error;throw new ApiError(0,'NETWORK','Não foi possível consultar a loja. Sua sacola foi mantida.');}
    const data=response.status===204?null:await response.json().catch(()=>null);
    if(!response.ok){
      if(response.status===401||data?.error?.code==='CSRF_INVALID')session=null;
      throw new ApiError(response.status,data?.error?.code||'INVALID_RESPONSE',data?.error?.message||'A loja não conseguiu concluir esta operação.',Number(response.headers.get('Retry-After'))||0,data?.error?.fields);
    }
    if(response.status!==204&&(!data||typeof data!=='object'))throw new ApiError(0,'INVALID_RESPONSE','Resposta inválida da loja. Tente novamente.');
    return data;
  }
  async function getSession(force=false){
    if(force)session=null;
    if(session)return session;
    if(!pending)pending=request('/session').then(data=>{
      if(typeof data.csrfToken!=='string'||!data.csrfToken||!(data.user===null||data.user?.role==='CUSTOMER'||data.user?.role==='OPERATOR'))throw new Error('Sessão inválida.');
      return accept(data);
    }).finally(()=>{pending=null;});
    return pending;
  }
  async function auth(action,login,password,nickname){
    if(!['login','register'].includes(action))throw new Error('Ação inválida.');
    if(typeof login!=='string'||!/^[A-Za-z0-9_-]{3,32}$/.test(login))throw new Error('Nome de usuário: use 3–32 letras ASCII, números, _ ou -.');
    const data=await request('/auth/'+action,{method:'POST',body:{login:login.toLowerCase(),password,...(action==='register'?{nickname:nicknameValue(nickname)}:{})}});
    if(!data.csrfToken||data.user?.role!=='CUSTOMER')throw new Error('Esta sessão não é de cliente.');
    return accept(data);
  }
  async function updateProfile(nickname){
    const data=await request('/me/perfil',{method:'PATCH',body:{nickname:nicknameValue(nickname)}});
    if(!data.csrfToken||data.user?.role!=='CUSTOMER')throw new Error('Perfil de cliente inválido.');
    return accept(data);
  }
  async function logout(){await request('/auth/logout',{method:'POST',body:{}});session=null;return getSession();}
  return{request,getSession,auth,logout,updateProfile,onSessionChange:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
}
export const api=createApi();
export const errorMessage=error=>`${error.message||'Não foi possível concluir.'}${error.retryAfter?` Aguarde ${error.retryAfter} segundos antes de tentar novamente.`:''}`;
export async function allPages(request,path,{signal}={}) {
  const items=[],seen=new Set();let cursor=null;
  for(let page=0;page<100;page++){
    const separator=path.includes('?')?'&':'?';
    const data=await request(path+separator+'limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{signal});
    if(!Array.isArray(data.items)||data.items.length>100||!(data.nextCursor===null||typeof data.nextCursor==='string'))throw new Error('Página de catálogo inválida.');
    items.push(...data.items);
    if(data.nextCursor===null)return items;
    if(!data.nextCursor||seen.has(data.nextCursor))throw new Error('Paginação repetida. Tente carregar novamente.');
    seen.add(data.nextCursor);cursor=data.nextCursor;
  }
  throw new Error('Limite de páginas atingido. Refine a consulta.');
}
