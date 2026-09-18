import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {authSubmitGuard} from '../src/views.js';
test('auth form blocks repeat submissions and restores buttons on history navigation',()=>{
 const listeners:Record<string,Function>={},page:Record<string,Function>={},button={disabled:false};
 const form={dataset:{} as Record<string,string>,addEventListener:(name:string,fn:Function)=>{listeners[name]=fn;},querySelectorAll:()=>[button]};
 runInNewContext(authSubmitGuard.replace(/^<script>|<\/script>$/g,''),{document:{querySelectorAll:()=>[form]},window:{addEventListener:(name:string,fn:Function)=>{page[name]=fn;}}});
 let prevented=0;const event={preventDefault:()=>{prevented++;}};
 listeners.submit(event);assert.equal(button.disabled,true);assert.equal(prevented,0);
 listeners.submit(event);assert.equal(prevented,1);
 page.pageshow();assert.equal(button.disabled,false);assert.equal(form.dataset.submitting,undefined);
 listeners.submit(event);assert.equal(prevented,1);
});
