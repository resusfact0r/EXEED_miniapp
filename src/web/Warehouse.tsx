import {useState,type FormEvent} from 'react';
import {api,request,states,type Order} from './orders';
type Entry=Order&{phone:string;name:string;vin?:string};
export function Warehouse(){
  const [token,setToken]=useState(''),[rows,setRows]=useState<Entry[]>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const headers={'x-admin-token':token};
  async function refresh(before?:number){
    const list=await request<Entry[]>('/admin/web-orders'+(before?'?before='+before:''),{headers});
    setRows(old=>before?[...(old??[]),...list]:list);
  }
  async function update(e:FormEvent<HTMLFormElement>,o:Entry){
    e.preventDefault();if(busy)return;const f=new FormData(e.currentTarget);setBusy(true);setError('');
    try{
      const action=o.state==='REVIEW'?'approve':o.state==='PICKUP_READY'?'complete':'packed';
      const parcel=action==='approve' && o.method==='cdek'?{weight:Number(f.get('weight')),length:Number(f.get('length')),width:Number(f.get('width')),height:Number(f.get('height')),itemGrams:o.items.map((_,n)=>Number(f.get('grams'+n)))}:undefined;
      await request('/admin/web-orders/'+o.number+'/'+action,{method:'POST',headers,body:JSON.stringify(action==='approve'?{confirmed:true,parcel}:{})});await refresh();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function label(n:number){
    try{const r=await fetch(api+'/admin/web-orders/'+n+'/label',{headers,cache:'no-store'});if(!r.ok)throw Error('Этикетка пока не готова.');
      const u=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=u;a.download='W'+n+'.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(u),5000);
    }catch(e){setError((e as Error).message);}
  }
  return <main className="container warehouse"><h1>Заказы с сайта</h1><form className="checkout-form" onSubmit={e=>{e.preventDefault();setError('');void refresh().catch(e=>setError(e.message));}}>
    <label>Ключ администратора<input type="password" required autoComplete="off" value={token} onChange={e=>{setToken(e.target.value);setRows(undefined);}}/></label>
    <button className="button">Загрузить заказы</button></form>{error&&<p role="alert">{error}</p>}{rows?.length===0&&<p>Открытых заказов нет.</p>}
    {rows?.map(o=><form key={o.number} className="checkout-form" onSubmit={e=>update(e,o)}><h2>W{o.number} · {states[o.state]}</h2><p>{o.name} · {o.phone}<br/>{o.address}<br/>{o.vin}</p>
      <ul>{o.items.map(i=><li key={i.code}>{i.code} · {i.name} × {i.quantity}</li>)}</ul>
      {o.state==='REVIEW'&&<>{o.method==='cdek'&&<>
        {[['weight','Вес с упаковкой, г'],['length','Длина, см'],['width','Ширина, см'],['height','Высота, см']].map(([k,title])=><label key={k}>{title}<input required min={1} type="number" name={k}/></label>)}
        {o.items.map((i,n)=><label key={i.code}>Вес единицы {i.code}, г<input required min={1} type="number" name={'grams'+n}/></label>)}</>}
        <label className="checkout-check"><input type="checkbox" required/>Применяемость проверена</label><button className="button" disabled={busy}>Подтвердить расчёт</button></>}
      {o.state==='PAID'&&<button className="button" disabled={busy}>{o.method==='cdek'?'Упакован · создать отправление':'Готов к выдаче'}</button>}
      {o.state==='PICKUP_READY'&&<button className="button" disabled={busy}>Выдан покупателю</button>}
      {o.tracking&&<button type="button" className="button" onClick={()=>label(o.number)}>Этикетка СДЭК · {o.tracking}</button>}</form>)}
      {rows && rows.length>=100 && <button className="button" onClick={()=>refresh(rows[rows.length-1].number).catch(e=>setError(e.message))}>Более ранние заказы</button>}</main>;
}
