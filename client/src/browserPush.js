// Permission is requested only from the profile button's user gesture.
async function call(path,options={}) {
  const response=await fetch(`/api/me/push${path}`,{credentials:'same-origin',...options,
    headers:{'content-type':'application/json'}});
  const body=await response.json();
  if(!response.ok) throw Object.assign(new Error(body.error||'push_request_failed'),{status:response.status});
  return body;
}
export const browserPushSupported=()=>Boolean(typeof window!=='undefined' && window.isSecureContext
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
const keyBytes=(value)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export async function browserPushStatus() {
  if(!browserPushSupported()) return {supported:false};
  const config=await call('/config');
  const registration=await navigator.serviceWorker.getRegistration('/');
  const subscription=await registration?.pushManager.getSubscription();
  const status=subscription?await call('/status',{method:'POST',body:JSON.stringify({endpoint:subscription.endpoint})}):{enabled:false};
  return {supported:true,configured:config.configured,enabled:status.enabled,permission:Notification.permission};
}
export async function enableBrowserPush() {
  if(!browserPushSupported()) throw new Error('push_unsupported');
  // Ask before the first await to retain the browser's user-activation requirement.
  const permission=await Notification.requestPermission();
  if(permission!=='granted') throw new Error('push_permission_denied');
  const config=await call('/config');
  if(!config.configured) throw new Error('push_not_configured');
  await navigator.serviceWorker.register('/sw.js',{scope:'/'});
  const registration=await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  const desired=keyBytes(config.publicKey);
  const oldKey=subscription?.options?.applicationServerKey;
  if(oldKey && Array.from(new Uint8Array(oldKey)).join()!==Array.from(desired).join()) {
    await call('/subscriptions',{method:'DELETE',body:JSON.stringify({endpoint:subscription.endpoint})});
    await subscription.unsubscribe();subscription=null;
  }
  subscription??=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:desired});
  try {
    await call('/subscriptions',{method:'POST',body:JSON.stringify(subscription.toJSON())});
  } catch(error) { await subscription.unsubscribe();throw error; }
  return browserPushStatus();
}
export async function disableBrowserPush({server=true}={}) {
  if(!browserPushSupported()) return;
  const registration=await navigator.serviceWorker.getRegistration('/');
  const subscription=await registration?.pushManager.getSubscription();
  if(!subscription) return;
  try {
    if(server) await call('/subscriptions',{method:'DELETE',body:JSON.stringify({endpoint:subscription.endpoint})});
  } finally {
    // Unsubscribe even if the session has expired. A shared device must not retain delivery.
    await subscription.unsubscribe();
    const notifications=await registration.getNotifications();
    notifications.forEach(notification=>notification.close());
  }
}
