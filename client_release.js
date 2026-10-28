'use strict';
// Public release metadata only. Activate after the uploaded build's URL is verified.
function releaseInfo(config) {
    const empty = {type:'client_release',enabled:false,version:'',url:''};
    if(config?.enabled !== true || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(config.version || '') || typeof config.url !== 'string' || config.url.length > 2048 || /[\s\x00-\x1f\x7f]/.test(config.url)) return empty;
    try {
        const url = new URL(config.url);
        if(url.protocol !== 'https:' || url.username || url.password || !url.hostname) return empty;
        return {type:'client_release',enabled:true,version:config.version,url:config.url};
    } catch { return empty; }
}
module.exports = {releaseInfo};
