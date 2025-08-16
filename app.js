const { useMemo, useState } = React;

function clampDay(d) { return Math.min(31, Math.max(1, Number(d) || 1)); }
function uid() { return Math.random().toString(36).slice(2, 9); }
function fmt(n) { return new Intl.NumberFormat('ru-RU').format(Math.round(n)); }

const sample = {
  incomes: [
    { id: 'i1', name: 'Зарплата', amount: 420000, day: 15 },
    { id: 'i2', name: 'Аванс', amount: 200000, day: 1 }
  ],
  bills: [
    { id: 'b1', name: 'Аренда', amount: 180000, day: 25, priority: 10 },
    { id: 'b2', name: 'Коммуналка', amount: 25000, day: 20, priority: 9 },
    { id: 'b3', name: 'Интернет', amount: 6000, day: 10, priority: 8 },
    { id: 'b4', name: 'Подписки', amount: 3000, day: 12, priority: 5 }
  ],
  loans: [
    { id: 'l1', name: 'Кредит карта', balance: 350000, apr: 34.9, minPayment: 20000, day: 27 },
    { id: 'l2', name: 'Потреб кредит', balance: 900000, apr: 21.0, minPayment: 35000, day: 5 }
  ],
  goals: [
    { id: 'g1', name: 'Подушка', target: 1000000, monthly: 50000 },
    { id: 'g2', name: 'Отпуск', target: 800000, monthly: 70000 }
  ],
  startBalance: 50000
};

function plan({ startBalance, incomes, bills, loans, goals, strategy = 'avalanche' }) {
  const days = Array.from({ length: 31 }, (_, i) => ({ day: i + 1, inflow: [], outflow: [] }));

  incomes.forEach(i => days[clampDay(i.day) - 1].inflow.push({ type: 'income', name: i.name, amount: i.amount }));
  bills.forEach(b => days[clampDay(b.day) - 1].outflow.push({ type: 'bill', name: b.name, amount: b.amount, priority: b.priority ?? 5 }));
  loans.forEach(l => days[clampDay(l.day) - 1].outflow.push({ type: 'loanMin', name: l.name, id: l.id, amount: l.minPayment, apr: l.apr }));
  goals.forEach(g => days[25 - 1].outflow.push({ type: 'goal', name: g.name, amount: g.monthly })); // условно 25-го

  // порядок выплат в течение дня
  days.forEach(d => d.outflow.sort((a, b) => {
    const order = { bill: 0, loanMin: 1, goal: 2 };
    const pa = a.type === 'bill' ? -(a.priority || 0) : 0;
    const pb = b.type === 'bill' ? -(b.priority || 0) : 0;
    return order[a.type] - order[b.type] || pa - pb;
  }));

  let balance = startBalance;
  let loanBalances = Object.fromEntries(loans.map(l => [l.id, l.balance]));
  const tl = [];
  let extra = 0;

  for (const d of days) {
    // доходы
    for (const infl of d.inflow) {
      balance += infl.amount;
      tl.push({ day: d.day, type: '+', name: infl.name, amount: infl.amount, balance });
    }

    // обязательные платежи
    for (const o of d.outflow) {
      if (o.type === 'loanMin') {
        const can = Math.min(balance, o.amount);
        balance -= can; loanBalances[o.id] -= can;
        tl.push({ day: d.day, type: '-', name: `${o.name} (мин.)`, amount: can, balance });
        if (can < o.amount) tl.push({ day: d.day, type: '!', name: `${o.name}: не хватило на мин. платёж`, amount: o.amount - can, balance });
      } else {
        const can = Math.min(balance, o.amount);
        balance -= can;
        tl.push({ day: d.day, type: '-', name: o.name, amount: can, balance });
        if (can < o.amount) tl.push({ day: d.day, type: '!', name: `${o.name}: частично оплачено`, amount: o.amount - can, balance });
      }
    }

    // 25% от любого поступления — в «ускоренное» погашение кредитов
    const got = d.inflow.reduce((s, i) => s + i.amount, 0);
    if (got > 0) extra += Math.floor(got * 0.25);

    // каждые чётные дни гоняем «ускоренные» платежи
    if (extra > 0 && d.day % 2 === 0) {
      const order = Object.entries(loanBalances)
        .map(([id, bal]) => ({ id, bal, apr: loans.find(l => l.id === id).apr }))
        .filter(x => x.bal > 0)
        .sort((a, b) => strategy === 'avalanche' ? (b.apr - a.apr || a.bal - b.bal) : (a.bal - b.bal || b.apr - a.apr));

      let toUse = Math.min(balance, extra);
      for (const t of order) {
        if (toUse <= 0) break;
        const pay = Math.min(toUse, t.bal);
        if (pay > 0) {
          balance -= pay; toUse -= pay; loanBalances[t.id] -= pay;
          const ln = loans.find(l => l.id === t.id);
          tl.push({ day: d.day, type: '-', name: `${ln.name} (ускор.)`, amount: pay, balance });
        }
      }
      // корректируем «extra»
      extra = Math.max(0, extra - (extra - toUse));
    }
  }

  const totals = {
    paidBills: tl.filter(t => t.type === '-' && !/(кредит|мин.|ускор.)/i.test(t.name)).reduce((s, t) => s + t.amount, 0),
    paidLoans: tl.filter(t => /(мин|ускор)/i.test(t.name)).reduce((s, t) => s + t.amount, 0),
    toGoals: tl.filter(t => /подушка|отпуск|цель/i.test(t.name)).reduce((s, t) => s + t.amount, 0),
    endBalance: balance
  };

  return { tl, loanBalances, totals };
}

// ---------------- UI ----------------
function Card({ children, title, right }) {
  return (
    <div className="bg-white/80 backdrop-blur border shadow-soft rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Num({ value, onChange }) {
  return <input type="number" className="w-full px-3 py-2 border rounded-xl" value={value} onChange={e => onChange(Number(e.target.value))} />;
}
function Day({ value, onChange }) {
  return <input type="number" className="w-24 px-3 py-2 border rounded-xl" min={1} max={31} value={value} onChange={e => onChange(clampDay(e.target.value))} />;
}

function Incomes({ items, setItems }) {
  const add = () => setItems([...items, { id: uid(), name: 'Доход', amount: 0, day: 1 }]);
  const rm = id => setItems(items.filter(i => i.id !== id));
  const up = (id, patch) => setItems(items.map(i => i.id === id ? { ...i, ...patch } : i));
  return (
    <Card title="Доходы" right={<button onClick={add} className="px-3 py-2 border rounded-xl">+ добавить</button>}>
      <div className="space-y-2">
        {items.map(i => (
          <div key={i.id} className="grid grid-cols-12 gap-2 items-center">
            <input className="col-span-5 px-3 py-2 border rounded-xl" value={i.name} onChange={e => up(i.id, { name: e.target.value })} />
            <div className="col-span-3"><Num value={i.amount} onChange={v => up(i.id, { amount: v })} /></div>
            <div className="col-span-3 flex items-center gap-2">
              <span className="text-sm text-slate-500">День</span>
              <Day value={i.day} onChange={v => up(i.id, { day: v })} />
            </div>
            <div className="col-span-1 text-right">
              <button className="text-red-600" onClick={() => rm(i.id)}>x</button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Bills({ items, setItems }) {
  const add = () => setItems([...items, { id: uid(), name: 'Платёж', amount: 0, day: 10, priority: 5 }]);
  const rm = id => setItems(items.filter(i => i.id !== id));
  const up = (id, patch) => setItems(items.map(i => i.id === id ? { ...i, ...patch } : i));

  return (
    <Card title="Обязательные платежи" right={<button onClick={add} className="px-3 py-2 border rounded-xl">+ добавить</button>}>
      <div className="space-y-2">
        {items.map(b => (
          <div key={b.id} className="grid grid-cols-12 gap-2 items-center">
            {/* Название */}
            <input
              className="col-span-4 px-3 py-2 border rounded-xl"
              value={b.name}
              onChange={e => up(b.id, { name: e.target.value })}
            />
            {/* Сумма */}
            <div className="col-span-3">
              <Num value={b.amount} onChange={v => up(b.id, { amount: v })} />
            </div>
            {/* День оплаты */}
            <div className="col-span-3 flex items-center gap-2">
              <span className="text-sm text-slate-500">День</span>
              <Day value={b.day} onChange={v => up(b.id, { day: v })} />
            </div>
            {/* Приоритет */}
            <div className="col-span-1">
              <input
                type="number"
                min="1"
                max="10"
                className="w-full px-3 py-2 border rounded-xl"
                value={b.priority}
                onChange={e => up(b.id, { priority: Number(e.target.value) })}
              />
            </div>
            {/* Удалить */}
            <div className="col-span-1 text-right">
              <button className="text-red-600" onClick={() => rm(b.id)}>x</button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Loans({ items, setItems }) {
  const add = () => setItems([...items, { id: uid(), name: 'Кредит', balance: 0, apr: 20, minPayment: 0, day: 5 }]);
  const rm = id => setItems(items.filter(i => i.id !== id));
  const up = (id, patch) => setItems(items.map(i => i.id === id ? { ...i, ...patch } : i));
  return (
    <Card title="Кредиты" right={<button onClick={add} className="px-3 py-2 border rounded-xl">+ добавить</button>}>
      <div className="space-y-2">
        {items.map(l => (
          <div key={l.id} className="grid grid-cols-12 gap-2 items-center">
            <input className="col-span-3 px-3 py-2 border rounded-xl" value={l.name} onChange={e => up(l.id, { name: e.target.value })} />
            <div className="col-span-2"><Num value={l.balance} onChange={v => up(l.id, { balance: v })} /></div>
            <div className="col-span-2"><input type="number" className="w-full px-3 py-2 border rounded-xl" value={l.apr} onChange={e => up(l.id, { apr: Number(e.target.value) })} /></div>
            <div className="col-span-2"><Num value={l.minPayment} onChange={v => up(l.id, { minPayment: v })} /></div>
            <div className="col-span-2 flex items-center gap-2">
              <span className="text-sm text-slate-500">День</span>
              <Day value={l.day} onChange={v => up(l.id, { day: v })} />
            </div>
            <div className="col-span-1 text-right">
              <button className="text-red-600" onClick={() => rm(l.id)}>x</button>
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs text-slate-500 mt-2">APR используется для приоритета выплат, проценты упрощены.</div>
    </Card>
  );
}

function Timeline({ tl }) {
  if (!tl.length) return null;
  return (
    <div className="space-y-2">
      {tl.map((t, idx) => {
        const cls = t.type === '+' ? 'bg-green-50' : t.type === '-' ? 'bg-red-50' : 'bg-amber-50';
        return (
          <div key={idx} className={`flex items-center justify-between border rounded-xl px-3 py-2 ${cls}`}>
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 border">день {t.day}</span>
              <span className="font-medium">{t.name}</span>
            </div>
            <div className="text-right">
              <div className="font-semibold">{t.type}{fmt(t.amount)}</div>
              <div className="text-xs text-slate-500">баланс: {fmt(t.balance)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function App() {
  const [incomes, setIncomes] = useState(sample.incomes);
  const [bills, setBills] = useState(sample.bills);
  const [loans, setLoans] = useState(sample.loans);
  const [goals, setGoals] = useState(sample.goals);
  const [startBalance, setStartBalance] = useState(sample.startBalance);
  const [strategy, setStrategy] = useState('avalanche');

  const { tl, loanBalances, totals } = useMemo(
    () => plan({ startBalance, incomes, bills, loans, goals, strategy }),
    [startBalance, incomes, bills, loans, goals, strategy]
  );

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ incomes, bills, loans, goals, startBalance }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'moneyflow_data.json'; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">MoneyFlow — PWA</h1>
          <p className="text-slate-500">Планируй доходы, платежи, кредиты и цели. Симуляция на 1 месяц.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50" onClick={exportJSON}>Экспорт</button>
          <label className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 cursor-pointer">Импорт
            <input type="file" accept="application/json" className="hidden" onChange={e => {
              const file = e.target.files?.[0]; if (!file) return;
              const r = new FileReader();
              r.onload = () => {
                try {
                  const d = JSON.parse(r.result);
                  if (d.incomes) setIncomes(d.incomes);
                  if (d.bills) setBills(d.bills);
                  if (d.loans) setLoans(d.loans);
                  if (d.goals) setGoals(d.goals);
                  if (typeof d.startBalance === 'number') setStartBalance(d.startBalance);
                } catch (_) { alert('Не удалось импортировать файл'); }
              };
              r.readAsText(file);
            }} />
          </label>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <Card title="Начальный баланс на 1 число">
            <div className="flex items-center gap-4">
              <Num value={startBalance} onChange={setStartBalance} />
              <div className="flex items-center gap-3 text-sm">
                <span className="text-slate-500">Стратегия кредитов:</span>
                <select className="px-3 py-2 border rounded-xl" value={strategy} onChange={e => setStrategy(e.target.value)}>
                  <option value="avalanche">Avalanche (высокая ставка)</option>
                  <option value="snowball">Snowball (меньший баланс)</option>
                </select>
              </div>
            </div>
          </Card>

          <Incomes items={incomes} setItems={setIncomes} />
          <Bills items={bills} setItems={setBills} />
          <Loans items={loans} setItems={setLoans} />

          <Card title="Цели накоплений" right={
            <button className="px-3 py-2 border rounded-xl" onClick={() => setGoals([...goals, { id: uid(), name: 'Цель', target: 0, monthly: 0 }])}>+ добавить</button>
          }>
            <div className="space-y-2">
              {goals.map(g => (
                <div key={g.id} className="grid grid-cols-12 gap-2 items-center">
                  <input className="col-span-5 px-3 py-2 border rounded-xl" value={g.name}
                    onChange={e => setGoals(goals.map(x => x.id === g.id ? { ...x, name: e.target.value } : x))} />
                  <div className="col-span-3"><Num value={g.target}
                    onChange={v => setGoals(goals.map(x => x.id === g.id ? { ...x, target: v } : x))} /></div>
                  <div className="col-span-3"><Num value={g.monthly}
                    onChange={v => setGoals(goals.map(x => x.id === g.id ? { ...x, monthly: v } : x))} /></div>
                  <div className="col-span-1 text-right">
                    <button className="text-red-600" onClick={() => setGoals(goals.filter(x => x.id !== g.id))}>x</button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <Card title="Итоги месяца">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="p-3 rounded-xl bg-green-50 border">
                <div className="text-slate-500">На кредиты</div>
                <div className="text-xl font-semibold">{fmt(totals.paidLoans)}</div>
              </div>
              <div className="p-3 rounded-xl bg-blue-50 border">
                <div className="text-slate-500">Счета/обязательные</div>
                <div className="text-xl font-semibold">{fmt(totals.paidBills)}</div>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 border">
                <div className="text-slate-500">В цели</div>
                <div className="text-xl font-semibold">{fmt(totals.toGoals)}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border">
                <div className="text-slate-500">Остаток на 31 число</div>
                <div className="text-xl font-semibold">{fmt(totals.endBalance)}</div>
              </div>
            </div>

            <div className="mt-3 text-sm">
              <div className="mb-1 text-slate-500">Остатки по кредитам</div>
              {Object.entries(loanBalances).map(([id, bal]) => {
                const loan = loans.find(l => l.id === id);
                return (
                  <div key={id} className="flex items-center justify-between border rounded-xl px-3 py-2 mb-2">
                    <div className="font-medium">{loan?.name || id}</div>
                    <div>{fmt(bal)}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Таймлайн операций">
            <Timeline tl={tl} />
          </Card>
        </div>
      </div>

      <footer className="text-center text-xs text-slate-400 mt-8">
        Это PWA: установи через «Добавить на экран». После первого запуска работает офлайн.
      </footer>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
