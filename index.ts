import express from 'express';
import {createApp,configuration} from './src/app.js';

const entrypoint=express();
entrypoint.disable('x-powered-by');
let application:ReturnType<typeof createApp>;
entrypoint.use((req,res,next)=>{
 try { application??=createApp(configuration()); }
 catch { res.setHeader('Cache-Control','no-store'); res.status(503).json({code:'configuration_required',message:'Operator must configure this deployment.'}); return; }
 application(req,res,next);
});
export default entrypoint;
