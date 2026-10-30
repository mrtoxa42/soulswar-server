'use strict';
const {AccountError}=require('./accounts');
function verifier({key=process.env.POKI_TEAM_API_KEY,fetcher=fetch,allowDebug=false}={}){
 return async token=>{
  if(!key)throw new AccountError('poki_not_configured',503);
  if(typeof token!=='string'||token.length<16||token.length>8192)throw new AccountError('invalid_poki_token',401);
  let response;
  try{response=await fetcher('https://user-vault.poki.com/auth/verify-token',{method:'GET',headers:{Authorization:'Bearer '+token,'X-Poki-Team-Api-Key':key},redirect:'error',signal:AbortSignal.timeout(8000)});}catch{throw new AccountError('poki_verification_unavailable',503);}
  if(!response.ok)throw new AccountError(response.status===401||response.status===403?'invalid_poki_token':'poki_verification_unavailable',response.status===401||response.status===403?401:503);
  let data;try{data=await response.json();}catch{throw new AccountError('invalid_poki_token',401);}
  const subject=data?.user_id;
  if(typeof subject!=='string'||!subject.length||subject.length>256||/[\x00-\x20\x7f]/.test(subject)||(!allowDebug&&subject==='debug-user-id'))throw new AccountError('invalid_poki_token',401);
  return subject;
 };
}
module.exports={verifier};
