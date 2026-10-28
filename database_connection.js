'use strict';
function connectionString(value){
 const parsed=new URL(value);
 if(!['postgres:','postgresql:'].includes(parsed.protocol))throw Error('Invalid database protocol');
 if(parsed.hostname.endsWith('.neon.tech'))parsed.searchParams.set('sslmode','verify-full');
 return parsed.toString();
}
module.exports={connectionString};
