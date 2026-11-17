const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {Test}=require('@nestjs/testing');
const {ValidationPipe}=require('@nestjs/common');
const {WebCheckoutModule}=require('../dist/web-checkout/module');
const {WebOrders}=require('../dist/web-checkout/service');
const {PrismaModule}=require('../dist/prisma/prisma.module');
const {PrismaService}=require('../dist/prisma/prisma.service');
const {AvtoligaService}=require('../dist/avtoliga/avtoliga.service');

// Isolated PostgreSQL cluster. Never run migrations or fixtures against an existing DATABASE_URL.
test('HTTP guest orders, owner isolation and idempotency against a migrated PostgreSQL database',async(t)=>{
  let bin;
  try{bin=execFileSync('pg_config',['--bindir'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();fs.accessSync(path.join(bin,'initdb'));}
  catch{if(process.env.GITHUB_ACTIONS)throw Error('PostgreSQL is required for checkout CI');t.skip('PostgreSQL server tools unavailable');return;}
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'exeed-checkout-'));let started=false,app;
  const port=40000+Math.floor(Math.random()*14000);
  const dbUrl='postgresql://tester@localhost:'+port+'/postgres?host='+encodeURIComponent(dir);
  try {
    execFileSync(path.join(bin,'initdb'),['-D',path.join(dir,'data'),'-U','tester','-A','trust','--no-locale','--encoding=UTF8'],{stdio:'pipe'});
    execFileSync(path.join(bin,'pg_ctl'),['-D',path.join(dir,'data'),'-l',path.join(dir,'log'),'-o',"-c listen_addresses='' -k "+dir+' -p '+port,'-w','start'],{stdio:'pipe'});started=true;
    process.env.DATABASE_URL=dbUrl;delete process.env.ORDER_NOTIFY_CHAT_IDS;
    execFileSync(path.resolve('node_modules/.bin/prisma'),['migrate','deploy'],{stdio:'pipe',env:{...process.env,DATABASE_URL:dbUrl}});
    const module=await Test.createTestingModule({imports:[WebCheckoutModule,PrismaModule]}).overrideProvider(AvtoligaService)
      .useValue({getLivePrices:async()=>new Map([['WEBTEST',{price:399,stockQty:2,packQty:1}]])}).compile();
    app=module.createNestApplication();app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:true}));
    await app.listen(0,'127.0.0.1');const origin=await app.getUrl();
    const db=app.get(PrismaService);
    await db.product.create({data:{code:'WEBTEST',name:'Тестовая деталь',price:399,stockQty:2}});
    const key=randomBytes(32).toString('hex'), headers={'x-order-key':key,'Content-Type':'application/json'};
    const dto={name:'Тест Покупатель',phone:'+79990001122',exactArticle:true,method:'pickup',consent:true,lines:[{code:'WEBTEST',quantity:1}]};
    const post=body=>fetch(origin+'/web/checkout/orders',{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal((await post({...dto,price:1})).status,400);
    const replies=await Promise.all([post(dto),post(dto)]);for(const r of replies)assert.equal(r.status,201);
    assert.equal(await db.webOrder.count(),1);const order=await replies[0].json();assert.equal(order.goodsCents,39900);
    assert.equal(order.state,'QUOTED');assert.ok(!('accessHash' in order));assert.ok(!('phone' in order));
    assert.equal((await fetch(origin+'/web/checkout/order',{headers})).status,200);
    assert.equal((await fetch(origin+'/web/checkout/order',{headers:{'x-order-key':randomBytes(32).toString('hex')}})).status,404);
    assert.equal((await fetch(origin+'/admin/web-orders')).status,401);
    await app.get(WebOrders).sync();
  }finally{
    if(app)await app.close();
    if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',path.join(dir,'data'),'-m','immediate','-w','stop'],{stdio:'pipe'});
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
