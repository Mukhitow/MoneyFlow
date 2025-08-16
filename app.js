const { useState, useMemo } = React;
function clampDay(d){ return Math.min(31, Math.max(1, Number(d) || 1)); }
function uid(){ return Math.random().toString(36).slice(2,9); }
function formatMoney(n){ return new Intl.NumberFormat('ru-RU').format(Math.round(n)); }
const sampleData={incomes:[{id:'inc1',name:'Зарплата',amount:420000,day:15},{id:'inc2',name:'Аванс',amount:200000,day:1}],bills:[{id:'b1',name:'Аренда',amount:180000,day:25,priority:10},{id:'b2',name:'Коммуналка',amount:25000,day:20,priority:9},{id:'b3',name:'Интернет',amount:6000,day:10,priority:8},{id:'b4',name:'Подписки',amount:3000,day:12,priority:5}],loans:[{id:'l1',name:'Кредит карта',balance:350000,apr:34.9,minPayment:20000,day:27},{id:'l2',name:'Потреб кредит',balance:900000,apr:21.0,minPayment:35000,day:5}],goals:[{id:'g1',name:'Подушка',target:1000000,monthly:50000},{id:'g2',name:'Отпуск',target:800000,monthly:70000}],startBalance:50000};
function planMonth({ startBalance, incomes, bills, loans, goals, strategy='avalanche' }){
  const days = Array.from({length:31}, (_,i)=>({ day:i+1, inflow:[], outflow:[] }));
  incomes.forEach(i => days[clampDay(i.day)-1].inflow.push({ type:'income', name:i.name, amount:i.amount }));
  bills.forEach(b => days[clampDay(b.day)-1].outflow.push({ type:'bill', name:b.name, amount:b.amount, priority:b.priority ?? 5 }));
  loans.forEach(l => days[clampDay(l.day)-1].outflow.push({ type:'loanMin', name:l.name, id:l.id, amount:l.minPayment, apr:l.apr }));
  goals.forEach(g => days[25-1].outflow.push({ type:'goal', name:g.name, amount:g.monthly }));
  days.forEach(d => d.outflow.sort((a,b)=>{ const order={bill:0,loanMin:1,goal:2}; const pa=a.type==='bill'?-(a.priority||0):0; const pb=b.type==='bill'?-(b.priority||0):0; return order[a.type]-order[b.type] || pa-pb; }));
  let balance = startBalance; let loanBalances = Object.fromEntries(loans.map(l=>[l.id,l.balance])); const timeline=[]; let extraForLoans=0;
  for (const d of days){
    for (const infl of d.inflow){ balance+=infl.amount; timeline.push({day:d.day,type:'+',name:infl.name,amount:infl.amount,balance}); }
    for (const o of d.outflow){
      if (o.type==='loanMin'){ const can=Math.min(balance,o.amount); balance-=can; loanBalances[o.id]-=can; timeline.push({day:d.day,type:'-',name:`${o.name} (мин.)`,amount:can,balance}); if (can<o.amount) timeline.push({day:d.day,type:'!',name:`${o.name}: не хватило на минимальный платёж`,amount:o.amount-can,balance}); }
      else { const can=Math.min(balance,o.amount); balance-=can; timeline.push({day:d.day,type:'-',name:o.name,amount:can,balance}); if (can<o.amount) timeline.push({day:d.day,type:'!',name:`${o.name}: частично оплачено`,amount:o.amount-can,balance}); }
    }
    const scheduledIncome = d.inflow.reduce((s,i)=>s+i.amount,0);
    if (scheduledIncome>0) extraForLoans += Math.max(0, Math.floor(scheduledIncome*0.25));
    if (extraForLoans>0 && d.day%2===0){
      const order = Object.entries(loanBalances).map(([id,bal])=>{ const loan=loans.find(l=>l.id===id); return {id,bal,apr:loan.apr}; }).filter(x=>x.bal>0).sort((a,b)=> strategy==='avalanche' ? (b.apr-a.apr || a.bal-b.bal) : (a.bal-b.bal || b.apr-a.apr));
      let toUse = Math.min(balance, extraForLoans);
      for (const t of order){ if (toUse<=0) break; const pay=Math.min(toUse,t.bal); if (pay>0){ balance-=pay; toUse-=pay; loanBalances[t.id]-=pay; const loan=loans.find(l=>l.id===t.id); timeline.push({day:d.day,type:'-',name:`${loan.name} (ускор.)`,amount:pay,balance}); } }
      extraForLoans = Math.max(0, extraForLoans - (Math.min(extraForLoans, extraForLoans - toUse)));
    }
  }
  const totals = {
    paidBills: timeline.filter(t=> t.type==='-' && !/(кредит|мин.|ускор.)/i.test(t.name)).reduce((s,t)=>s+t.amount,0),
    paidLoans: timeline.filter(t=> /(мин|ускор)/i.test(t.name)).reduce((s,t)=>s+t.amount,0),
    toGoals: timeline.filter(t=> /подушка|отпуск|цель/i.test(t.name)).reduce((s,t)=>s+t.amount,0),
    endBalance: balance
  };
  return { timeline, loanBalances, totals };
}
function Section({title, right, children}){
  return (<div className="card" style={{marginBottom:12}}>
    <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8}}>
      <div className="title">{title}</div>{right}
    </div>{children}
  </div>);
}
function NumberInput({value, onChange}){ return <input type="number" value={value} onChange={e=>onChange(Number(e.target.value))} step="100" />; }
function DayInput({value, onChange}){ return <input type="number" value={value} min={1} max={31} onChange={e=>onChange(clampDay(e.target.value))} />; }
function IncomesEditor({items,setItems}){
  const add=()=>setItems([...items,{id:uid(),name:'Доход',amount:0,day:1}]);
  const rm=id=>setItems(items.filter(i=>i.id!==id));
  const up=(id,patch)=>setItems(items.map(i=>i.id===id?{...i,...patch}:i));
  return <Section title="Доходы" right={<button className="btn" onClick={add}>+ добавить</button>}>
    <div className="grid">
      {items.map(i=><div key={i.id} className="row">
        <input value={i.name} onChange={e=>up(i.id,{name:e.target.value})}/>
        <NumberInput value={i.amount} onChange={v=>up(i.id,{amount:v})}/>
        <div><span className="muted">День</span> <DayInput value={i.day} onChange={v=>up(i.id,{day:v})}/></div>
        <div style={{textAlign:'right'}}><button className="btn" onClick={()=>rm(i.id)}>x</button></div>
      </div>)}
    </div>
  </Section>;
}
function BillsEditor({items,setItems}){
  const add=()=>setItems([...items,{id:uid(),name:'Платёж',amount:0,day:10,priority:5}]);
  const rm=id=>setItems(items.filter(i=>i.id!==id));
  const up=(id,patch)=>setItems(items.map(i=>i.id===id?{...i,...patch}:i));
  return <Section title="Обязательные платежи" right={<button className="btn" onClick={add}>+ добавить</button>}>
    <div className="grid">
      {items.map(b=><div key={b.id} className="row">
        <input value={b.name} onChange={e=>up(b.id,{name:e.target.value})}/>
        <NumberInput value={b.amount} onChange={v=>up(b.id,{amount:v})}/>
        <div><span className="muted">День</span> <DayInput value={b.day} onChange={v=>up(b.id,{day:v})}/></div>
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <input type="number" value={b.priority} min="1" max="10" onChange={e=>up(b.id,{priority:Number(e.target.value)})}/>
          <button className="btn" onClick={()=>rm(b.id)}>x</button>
        </div>
      </div>)}
    </div>
  </Section>;
}
function LoansEditor({items,setItems}){
  const add=()=>setItems([...items,{id:uid(),name:'Кредит',balance:0,apr:20,minPayment:0,day:5}]);
  const up=(id,patch)=>setItems(items.map(i=>i.id===id?{...i,...patch}:i));
  return <Section title="Кредиты" right={<button className="btn" onClick={add}>+ добавить</button>}>
    <div className="grid">
      {items.map(l=><div key={l.id} className="row">
        <input value={l.name} onChange={e=>up(l.id,{name:e.target.value})}/>
        <NumberInput value={l.balance} onChange={v=>up(l.id,{balance:v})}/>
        <input type="number" value={l.apr} onChange={e=>up(l.id,{apr:Number(e.target.value)})}/>
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <NumberInput value={l.minPayment} onChange={v=>up(l.id,{minPayment:v})}/>
          <span className="muted">День</span> <DayInput value={l.day} onChange={v=>up(l.id,{day:v})}/>
        </div>
      </div>)}
    </div>
    <div className="muted" style={{marginTop:8}}>APR используется для приоритета выплат, проценты упрощены.</div>
  </Section>;
}
function Timeline({timeline}){
  return <div className="grid">
    {timeline.map((t,idx)=>{
      const cls = t.type==='+' ? 'timeline timeline-in' : t.type==='-' ? 'timeline timeline-out' : 'timeline timeline-warn';
      return <div key={idx} className={cls}>
        <div style={{display:'flex', gap:8, alignItems:'center'}}><span className="pill">день {t.day}</span><b>{t.name}</b></div>
        <div style={{textAlign:'right'}}><div><b>{t.type}{formatMoney(t.amount)}</b></div><div className="muted">баланс: {formatMoney(t.balance)}</div></div>
      </div>
    })}
  </div>;
}
function App(){
  const [incomes,setIncomes]=React.useState(sampleData.incomes);
  const [bills,setBills]=React.useState(sampleData.bills);
  const [loans,setLoans]=React.useState(sampleData.loans);
  const [goals,setGoals]=React.useState(sampleData.goals);
  const [startBalance,setStartBalance]=React.useState(sampleData.startBalance);
  const [strategy,setStrategy]=React.useState('avalanche');
  const { timeline, loanBalances, totals } = useMemo(()=>planMonth({ startBalance, incomes, bills, loans, goals, strategy }), [startBalance,incomes,bills,loans,goals,strategy]);
  const exportJSON=()=>{ const data={incomes,bills,loans,goals,startBalance}; const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='moneyflow_data.json'; a.click(); URL.revokeObjectURL(a.href); };
  return (<div className="container">
    <header style={{display:'flex', alignItems:'center', justifyContent:'space-between', margin:'16px 0'}}>
      <div><div className="title">MoneyFlow — PWA</div><div className="muted">Планируй доходы, платежи, кредиты и цели. Симуляция на 1 месяц.</div></div>
      <div style={{display:'flex', gap:8}}>
        <button className="btn" onClick={exportJSON}>Экспорт</button>
        <label className="btn">Импорт
          <input type="file" accept="application/json" style={{display:'none'}} onChange={e=>{const f=e.target.files&&e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{ try{ const d=JSON.parse(r.result); if(d.incomes) setIncomes(d.incomes); if(d.bills) setBills(d.bills); if(d.loans) setLoans(d.loans); if(d.goals) setGoals(d.goals); if(typeof d.startBalance==='number') setStartBalance(d.startBalance);}catch(_){ alert('Не удалось импортировать файл'); }}; r.readAsText(f); }}/>
        </label>
      </div>
    </header>
    <div className="grid grid-5">
      <div style={{gridColumn:'span 3'}} className="grid">
        <div className="card"><div style={{display:'flex', gap:12, alignItems:'center'}}>
          <input type="number" value={startBalance} onChange={e=>setStartBalance(Number(e.target.value))}/>
          <div className="muted" style={{display:'flex', gap:8, alignItems:'center'}}>
            <span>Стратегия кредитов:</span>
            <select value={strategy} onChange={e=>setStrategy(e.target.value)}>
              <option value="avalanche">Avalanche (высокая ставка)</option>
              <option value="snowball">Snowball (меньший баланс)</option>
            </select>
          </div>
        </div></div>
        <IncomesEditor items={incomes} setItems={setIncomes}/>
        <BillsEditor items={bills} setItems={setBills}/>
        <LoansEditor items={loans} setItems={setLoans}/>
        <Section title="Цели накоплений" right={<button className="btn" onClick={()=>setGoals([...goals,{id:uid(),name:'Цель',target:0,monthly:0}])}>+ добавить</button>}>
          <div className="grid">
            {goals.map(g => <div key={g.id} className="row">
              <input value={g.name} onChange={e=>setGoals(goals.map(x=>x.id===g.id?{...x,name:e.target.value}:x))}/>
              <input type="number" value={g.target} onChange={e=>setGoals(goals.map(x=>x.id===g.id?{...x,target:Number(e.target.value)}:x))}/>
              <input type="number" value={g.monthly} onChange={e=>setGoals(goals.map(x=>x.id===g.id?{...x,monthly:Number(e.target.value)}:x))}/>
              <div style={{textAlign:'right'}}><button className="btn" onClick={()=>setGoals(goals.filter(x=>x.id!==g.id))}>x</button></div>
            </div>)}
          </div>
        </Section>
      </div>
      <div style={{gridColumn:'span 2'}} className="grid">
        <Section title="Итоги месяца">
          <div className="grid grid-2">
            <div className="card"><div className="muted">На кредиты</div><div className="title">{formatMoney(totals.paidLoans)}</div></div>
            <div className="card"><div className="muted">Счета/обязательные</div><div className="title">{formatMoney(totals.paidBills)}</div></div>
            <div className="card"><div className="muted">В цели</div><div className="title">{formatMoney(totals.toGoals)}</div></div>
            <div className="card"><div className="muted">Остаток на 31 число</div><div className="title">{formatMoney(totals.endBalance)}</div></div>
          </div>
          <div style={{marginTop:8}} className="muted">Остатки по кредитам</div>
          {Object.entries(loanBalances).map(([id, bal]) => {
            const loan = loans.find(l=>l.id===id);
            return <div key={id} className="timeline"><b>{loan?.name || id}</b><span>{formatMoney(bal)}</span></div>
          })}
        </Section>
        <Section title="Таймлайн операций">
          <div className="grid">{timeline.map((t,idx)=>{
            const cls = t.type==='+' ? 'timeline timeline-in' : t.type==='-' ? 'timeline timeline-out' : 'timeline timeline-warn';
            return <div key={idx} className={cls}>
              <div style={{display:'flex', gap:8, alignItems:'center'}}><span className="pill">день {t.day}</span><b>{t.name}</b></div>
              <div style={{textAlign:'right'}}><div><b>{t.type}{formatMoney(t.amount)}</b></div><div className="muted">баланс: {formatMoney(t.balance)}</div></div>
            </div>
          })}</div>
        </Section>
      </div>
    </div>
    <footer>Это PWA: установи на устройство через «Добавить на экран» · Работает офлайн после первого посещения</footer>
  </div>);
}
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);