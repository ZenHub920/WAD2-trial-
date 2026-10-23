/* Only notification handling: this worker never caches private pages or API responses. */
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let payload;
    try { payload=event.data?.json(); } catch { return; }
    if(typeof payload?.notificationId!=='string' || typeof payload?.subscriptionId!=='string') return;
    // Recheck the cookie-backed account, read state, category preference and chat
    // membership before revealing a title. A delayed push after logout is discarded.
    const response=await fetch(`/api/me/push/notifications/${encodeURIComponent(payload.notificationId)}?subscriptionId=${encodeURIComponent(payload.subscriptionId)}`,
      {credentials:'same-origin',cache:'no-store'}).catch(()=>null);
    if(!response?.ok) return;
    const {notification}=await response.json();
    const target=new URL(notification.path,self.location.origin);
    if(target.origin!==self.location.origin) return;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows) client.postMessage({type:'encore-notification'});
    await self.registration.showNotification('Encore',{
      body:notification.title,tag:`encore:${notification.id}`,icon:'/push-icon.svg',
      data:{path:target.pathname+target.search+target.hash},
    });
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const target=new URL(event.notification.data?.path||'/profile#notifications',self.location.origin);
    if(target.origin!==self.location.origin) return;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(client=>new URL(client.url).origin===target.origin);
    if(existing) { await existing.navigate(target.href);await existing.focus(); }
    else await self.clients.openWindow(target.href);
  })());
});
