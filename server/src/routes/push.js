export function registerPushRoutes(router,{delivery,requireUser}) {
  const route=(method,path,handler)=>router[method](path,requireUser,(req,res,next)=>{
    try { return handler(req,res); } catch(error) { return next(error); }
  });
  route('get','/me/push/config',(_req,res)=>res.json(delivery.publicConfig()));
  route('post','/me/push/status',(req,res)=>res.json(delivery.subscriptionStatus(req.user.id,req.body?.endpoint)));
  route('post','/me/push/subscriptions',(req,res)=>res.status(201).json(delivery.subscribe(req.user.id,req.body)));
  route('delete','/me/push/subscriptions',(req,res)=>res.json(delivery.unsubscribe(req.user.id,req.body?.endpoint)));
  route('get','/me/push/notifications/:id',(req,res)=>{
    res.set('Cache-Control','no-store');
    const notification=delivery.notification(req.user.id,req.params.id,req.query.subscriptionId);
    if(!notification) return res.status(404).json({error:'notification_not_found'});
    return res.json({notification});
  });
}
