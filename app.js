import React, { useMemo, useState } from "react";

/**
 * MoneyFlow — простое веб-MVP для планирования личных финансов
 * -------------------------------------------------------------
 * Что уже умеет:
 * - Добавлять доходы (повторяются ежемесячно на выбранный день)
 * - Добавлять обязательные платежи (коммуналка и т.п.)
 * - Добавлять кредиты (баланс, ставка, мин. платёж, день оплаты)
 * - Добавлять цели накоплений
 * - Выбирать стратегию погашения кредитов: Snowball (минимальный баланс) или Avalanche (максимальная ставка)
 * - Считать план распределения на 1 месяц вперёд (с 1 по 31 число) с помесячной симуляцией cashflow
 * - Показывать таймлайн движения денег и краткий отчёт
 *
 * Ограничения MVP:
 * - Упрощённая модель процентов (APR учитывается только для приоритета, проценты не капитализируются ежедневно)
 * - Все суммы — в единой валюте, без комиссий
 * - Нет авторизации/синхронизации
 */

// ------- Типы данных -------
const today = new Date();
const currentMonth = today.getMonth();
const currentYear = today.getFullYear();

function clampDay(d) {
  return Math.min(31, Math.max(1, Number(d) || 1));
}

const sampleData = {
  incomes: [
    { id: "inc1", name: "Зарплата", amount: 420000, day: 15 },
    { id: "inc2", name: "Аванс", amount: 200000, day: 1 },
  ],
  bills: [
    { id: "b1", name: "Аренда", amount: 180000, day: 25, priority: 10 },
    { id: "b2", name: "Коммуналка", amount: 25000, day: 20, priority: 9 },
    { id: "b3", name: "Интернет", amount: 6000, day: 10, priority: 8 },
    { id: "b4", name: "Подписки", amount: 3000, day: 12, priority: 5 },
  ],
  loans: [
    { id: "l1", name: "Кредит карта", balance: 350000, apr: 34.9, minPayment: 20000, day: 27 },
    { id: "l2", name: "Потреб кредит", balance: 900000, apr: 21.0, minPayment: 35000, day: 5 },
  ],
  goals: [
    { id: "g1", name: "Подушка", target: 1000000, monthly: 50000 },
    { id: "g2", name: "Отпуск", target: 800000, monthly: 70000 },
  ],
  startBalance: 50000,
};

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function Section({ title, children, right }) {
  return (
    <div className="bg-white/70 backdrop-blur p-4 rounded-2xl shadow-sm border mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function NumberInput({ value, onChange, placeholder }) {
  return (
    <input
      type="number"
      className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      placeholder={placeholder}
      step="100"
    />
  );
}

function DayInput({ value, onChange }) {
  return (
    <input
      type="number"
      className="w-20 px-3 py-2 border rounded-xl focus:outline-none focus:ring"
      value={value}
      onChange={(e) => onChange(clampDay(e.target.value))}
      min={1}
      max={31}
    />
  );
}

function Pill({ children }) {
  return <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 border">{children}</span>;
}

// ------- Основной алгоритм планирования -------
function planMonth({ startBalance, incomes, bills, loans, goals, strategy = "avalanche" }) {
  // Сформируем события по дням
  const days = Array.from({ length: 31 }, (_, i) => ({ day: i + 1, inflow: [], outflow: [], notes: [] }));

  incomes.forEach((i) => days[clampDay(i.day) - 1].inflow.push({ type: "income", name: i.name, amount: i.amount }));
  bills.forEach((b) => days[clampDay(b.day) - 1].outflow.push({ type: "bill", name: b.name, amount: b.amount, priority: b.priority ?? 5 }));
  loans.forEach((l) => days[clampDay(l.day) - 1].outflow.push({ type: "loanMin", name: l.name, id: l.id, amount: l.minPayment, apr: l.apr }));
  goals.forEach((g) => days[25 - 1].outflow.push({ type: "goal", name: g.name, amount: g.monthly })); // по умолчанию 25-го откладываем на цели

  // Сортировка выплат за день: сначала высокоприоритетные счета, затем мин.платежи по кредитам, далее цели
  days.forEach((d) => {
    d.outflow.sort((a, b) => {
      const order = { bill: 0, loanMin: 1, goal: 2 };
      const pa = a.type === "bill" ? -(a.priority || 0) : 0;
      const pb = b.type === "bill" ? -(b.priority || 0) : 0;
      return order[a.type] - order[b.type] || pa - pb;
    });
  });

  // Симуляция кэша
  let balance = startBalance;
  let loanBalances = Object.fromEntries(loans.map((l) => [l.id, l.balance]));
  const timeline = [];
  let extraForLoans = 0;

  for (const d of days) {
    // Доходы
    for (const infl of d.inflow) {
      balance += infl.amount;
      timeline.push({ day: d.day, type: "+", name: infl.name, amount: infl.amount, balance });
    }

    // Обязательные платежи
    for (const o of d.outflow) {
      if (o.type === "loanMin") {
        const can = Math.min(balance, o.amount);
        balance -= can;
        loanBalances[o.id] -= can;
        timeline.push({ day: d.day, type: "-", name: `${o.name} (мин.)`, amount: can, balance });
        if (can < o.amount) timeline.push({ day: d.day, type: "!", name: `${o.name}: не хватило на минимальный платёж`, amount: o.amount - can, balance });
      } else {
        const can = Math.min(balance, o.amount);
        balance -= can;
        timeline.push({ day: d.day, type: "-", name: o.name, amount: can, balance });
        if (can < o.amount) timeline.push({ day: d.day, type: "!", name: `${o.name}: частично оплачено`, amount: o.amount - can, balance });
      }
    }

    // Доп. средства для кредитов распределяем в два дня после зарплат/аванса
    const scheduledIncome = d.inflow.reduce((s, i) => s + i.amount, 0);
    if (scheduledIncome > 0) {
      extraForLoans += Math.max(0, Math.floor(scheduledIncome * 0.25)); // правило по умолчанию: 25% от любого поступления — ускоренное погашение
    }

    // Каждые 2 дня после дохода пробуем отправить «ускоренные» платежи
    if (extraForLoans > 0 && d.day % 2 === 0) {
      const order = Object.entries(loanBalances)
        .map(([id, bal]) => {
          const loan = loans.find((l) => l.id === id);
          return { id, bal, apr: loan.apr };
        })
        .filter((x) => x.bal > 0)
        .sort((a, b) => {
          if (strategy === "avalanche") return b.apr - a.apr || a.bal - b.bal;
          return a.bal - b.bal || b.apr - a.apr; // snowball
        });

      let toUse = Math.min(balance, extraForLoans);
      for (const t of order) {
        if (toUse <= 0) break;
        const pay = Math.min(toUse, t.bal);
        if (pay > 0) {
          balance -= pay;
          toUse -= pay;
          loanBalances[t.id] -= pay;
          const loan = loans.find((l) => l.id === t.id);
          timeline.push({ day: d.day, type: "-", name: `${loan.name} (ускор.)`, amount: pay, balance });
        }
      }
      extraForLoans = Math.max(0, extraForLoans - (Math.min(extraForLoans, toUse === 0 ? Math.min(balance + toUse, extraForLoans) : extraForLoans)));
    }
  }

  const totals = {
    paidBills: timeline.filter((t) => t.type === "-" && !/кредит/i.test(t.name) && !/(ускор|мин)/i.test(t.name)).reduce((s, t) => s + t.amount, 0),
    paidLoans: timeline.filter((t) => /(мин|ускор)/i.test(t.name)).reduce((s, t) => s + t.amount, 0),
    toGoals: timeline.filter((t) => /подушка|отпуск|цель/i.test(t.name)).reduce((s, t) => s + t.amount, 0),
    endBalance: balance,
  };

  return { days, timeline, loanBalances, totals };
}

// ------- Компоненты ввода -------
function IncomesEditor({ items, setItems }) {
  const add = () => setItems([...items, { id: uid(), name: "Доход", amount: 0, day: 1 }]);
  const remove = (id) => setItems(items.filter((i) => i.id !== id));
  const update = (id, patch) => setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  return (
    <Section title="Доходы" right={<button className="btn" onClick={add}>+ добавить</button>}>
      <div className="space-y-2">
        {items.map((i) => (
          <div key={i.id} className="grid grid-cols-12 gap-2 items-center">
            <input className="col-span-5 px-3 py-2 border rounded-xl" value={i.name} onChange={(e) => update(i.id, { name: e.target.value })} />
            <div className="col-span-3"><NumberInput value={i.amount} onChange={(v) => update(i.id, { amount: v })} /></div>
            <div className="col-span-2 flex items-center gap-2"><span className="text-sm text-slate-500">День</span><DayInput value={i.day} onChange={(v) => update(i.id, { day: v })} /></div>
            <div className="col-span-2 text-right"><button className="text-red-600" onClick={() => remove(i.id)}>удалить</button></div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function BillsEditor({ items, setItems }) {
  const add = () => setItems([...items, { id: uid(), name: "Платёж", amount: 0, day: 10, priority: 5 }]);
  const remove = (id) => setItems(items.filter((i) => i.id !== id));
  const update = (id, patch) => setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  return (
    <Section title="Обязательные платежи (коммуналка и т.п.)" right={<button className="btn" onClick={add}>+ добавить</button>}>
      <div className="space-y-2">
        {items.map((b) => (
          <div key={b.id} className="grid grid-cols-12 gap-2 items-center">
            <input className="col-span-4 px-3 py-2 border rounded-xl" value={b.name} onChange={(e) => update(b.id, { name: e.target.value })} />
            <div className="col-span-3"><NumberInput value={b.amount} onChange={(v) => update(b.id, { amount: v })} /></div>
            <div className="col-span-3 flex items-center gap-2"><span className="text-sm text-slate-500">День</span><DayInput value={b.day} onChange={(v) => update(b.id, { day: v })} /></div>
            <div className="col-span-1"><input type="number" className="w-full px-3 py-2 border rounded-xl" value={b.priority} onChange={(e) => update(b.id, { priority: Number(e.target.value) })} min={1} max={10} /></div>
            <div className="col-span-1 text-right"><button className="text-red-600" onClick={() => remove(b.id)}>x</button></div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function LoansEditor({ items, setItems }) {
  const add = () => setItems([...items, { id: uid(), name: "Кредит", balance: 0, apr: 20, minPayment: 0, day: 5 }]);
  const remove = (id) => setItems(items.filter((i) => i.id !== id));
  const update = (id, patch) => setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  return (
    <Section title="Кредиты" right={<button className="btn" onClick={add}>+ добавить</button>}>
      <div className="space-y-2">
        {items.map((l) => (
          <div key={l.id} className="grid grid-cols-12 gap-2 items-center">
            <input className="col-span-3 px-3 py-2 border rounded-xl" value={l.name} onChange={(e) => update(l.id, { name: e.target.value })} />
            <div className="col-span-2"><NumberInput value={l.balance} onChange={(v) => update(l.id, { balance: v })} /></div>
            <div className="col-span-2"><input type="number" className="w-full px-3 py-2 border rounded-xl" value={l.apr} onChange={(e) => update(l.id, { apr: Number(e.target.value) })} /></div>
            <div className="col-span-2"><NumberInput value={l.minPayment} onChange={(v) => update(l.id, { minPayment: v })} /></div>
            <div className="col-span-2 flex items-center gap-2"><span className="text-sm text-slate-500">День</span><DayInput value={l.day} onChange={(v) => update(l.id, { day: v })} /></div>
            <div className="col-span-1 text-right"><button className="text-red-600" onClick={() => remove(l.id)}>x</button></div>
          </div>
        ))}
      </div>
      <div className="text-xs text-slate-500 mt-2">Баланс — текущий остаток долга. APR — годовая ставка (%). Мин. платёж — ежемесячный.</div>
    </Section>
  );
}

function GoalsEditor({ items, setItems }) {
  const add = () => setItems([...items, { id: uid(), name: "Цель", target: 0, monthly: 0 }]);
  const remove = (id) => setItems(items.filter((i) => i.id !== id));
  const update = (id, patch) => setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  return (
    <Section title="Цели накоплений" right={<button className="btn" onClick={add}>+ добавить</button>}>
      <div className="space-y-2">
        {items.map((g) => (
          <div key={g.id} className="grid grid-cols-12 gap-2 items-center">
            <input className="col-span-4 px-3 py-2 border rounded-xl" value={g.name} onChange={(e) => update(g.id, { name: e.target.value })} />
            <div className="col-span-3"><NumberInput value={g.target} onChange={(v) => update(g.id, { target: v })} /></div>
            <div className="col-span-3"><NumberInput value={g.monthly} onChange={(v) => update(g.id, { monthly: v })} /></div>
            <div className="col-span-2 text-right"><button className="text-red-600" onClick={() => remove(g.id)}>x</button></div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Timeline({ timeline }) {
  if (!timeline.length) return null;
  return (
    <div className="space-y-2">
      {timeline.map((t, idx) => (
        <div key={idx} className={`flex items-center justify-between border rounded-xl px-3 py-2 ${t.type === "+" ? "bg-green-50" : t.type === "-" ? "bg-red-50" : "bg-yellow-50"}`}>
          <div className="flex items-center gap-3">
            <Pill>день {t.day}</Pill>
            <span className="font-medium">{t.name}</span>
          </div>
          <div className="text-right">
            <div className="font-semibold">{t.type}{formatMoney(t.amount)}</div>
            <div className="text-xs text-slate-500">баланс: {formatMoney(t.balance)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatMoney(n) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n));
}

export default function App() {
  const [incomes, setIncomes] = useState(sampleData.incomes);
  const [bills, setBills] = useState(sampleData.bills);
  const [loans, setLoans] = useState(sampleData.loans);
  const [goals, setGoals] = useState(sampleData.goals);
  const [startBalance, setStartBalance] = useState(sampleData.startBalance);
  const [strategy, setStrategy] = useState("avalanche");

  const { timeline, loanBalances, totals } = useMemo(
    () => planMonth({ startBalance, incomes, bills, loans, goals, strategy }),
    [startBalance, incomes, bills, loans, goals, strategy]
  );

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ incomes, bills, loans, goals, startBalance }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "moneyflow_mvp.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.incomes) setIncomes(data.incomes);
        if (data.bills) setBills(data.bills);
        if (data.loans) setLoans(data.loans);
        if (data.goals) setGoals(data.goals);
        if (typeof data.startBalance === "number") setStartBalance(data.startBalance);
      } catch (e) {
        alert("Не удалось импортировать файл");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 text-slate-800">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">MoneyFlow — пробная версия</h1>
            <p className="text-slate-500">Планируй доходы, платежи, кредиты и цели. Симуляция на 1 месяц вперёд.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={exportJSON}>Экспорт</button>
            <label className="btn cursor-pointer">
              Импорт
              <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importJSON(e.target.files[0])} />
            </label>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-4">
            <Section title="Начальный баланс на 1 число">
              <div className="flex items-center gap-4">
                <NumberInput value={startBalance} onChange={setStartBalance} />
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-slate-500">Стратегия кредитов:</span>
                  <select className="px-3 py-2 border rounded-xl" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                    <option value="avalanche">Avalanche (сначала высокая ставка)</option>
                    <option value="snowball">Snowball (сначала меньший баланс)</option>
                  </select>
                </div>
              </div>
            </Section>

            <IncomesEditor items={incomes} setItems={setIncomes} />
            <BillsEditor items={bills} setItems={setBills} />
            <LoansEditor items={loans} setItems={setLoans} />
            <GoalsEditor items={goals} setItems={setGoals} />
          </div>

          <div className="lg:col-span-2 space-y-4">
            <Section title="Итоги месяца">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="p-3 rounded-xl bg-green-50 border">
                  <div className="text-slate-500">На кредиты</div>
                  <div className="text-xl font-semibold">{formatMoney(totals.paidLoans)}</div>
                </div>
                <div className="p-3 rounded-xl bg-blue-50 border">
                  <div className="text-slate-500">Счета/обязательные</div>
                  <div className="text-xl font-semibold">{formatMoney(totals.paidBills)}</div>
                </div>
                <div className="p-3 rounded-xl bg-amber-50 border">
                  <div className="text-slate-500">В цели</div>
                  <div className="text-xl font-semibold">{formatMoney(totals.toGoals)}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border">
                  <div className="text-slate-500">Остаток на 31 число</div>
                  <div className="text-xl font-semibold">{formatMoney(totals.endBalance)}</div>
                </div>
              </div>
              <div className="mt-3 text-sm">
                <div className="mb-1 text-slate-500">Остатки по кредитам</div>
                {Object.entries(loanBalances).map(([id, bal]) => {
                  const loan = loans.find((l) => l.id === id);
                  return (
                    <div key={id} className="flex items-center justify-between border rounded-xl px-3 py-2 mb-2">
                      <div className="font-medium">{loan?.name || id}</div>
                      <div>{formatMoney(bal)}</div>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section title="Таймлайн операций">
              <Timeline timeline={timeline} />
            </Section>
          </div>
        </div>

        <footer className="text-center text-xs text-slate-400 mt-8">
          {`Месяц симуляции: ${new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(currentYear, currentMonth, 1))}`} · Это MVP, расчёты упрощены
        </footer>
      </div>

      {/* стили для кнопок */}
      <style>{`
        .btn { @apply px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 active:scale-[0.99] transition; }
      `}</style>
    </div>
  );
}
