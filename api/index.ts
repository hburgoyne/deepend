import {createApp,configuration} from '../src/app.js';
import type {Request,Response} from 'express';
let app:ReturnType<typeof createApp>;
export default function handler(req:Request,res:Response){
 try{app??=createApp(configuration());return app(req,res);}
 catch{res.setHeader('Cache-Control','no-store');res.status(503).json({code:'configuration_required',message:'Operator must configure this deployment.'});}
}
