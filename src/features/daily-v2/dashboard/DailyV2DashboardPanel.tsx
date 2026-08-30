import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createDashboardController, type DashboardState } from './dailyV2DashboardController';
import { DailyV2DashboardView } from './DailyV2DashboardView';
import type { DashboardInput, DashboardSnapshot } from './dailyV2DashboardModel';

/** Mounted only inside the authorized boundary; keeps safe aggregates in memory only. */
export function DailyV2DashboardPanel({ initialInput, generate, onInputSubmit }: {
  initialInput: DashboardInput;
  generate: (input: DashboardInput) => Promise<DashboardSnapshot>;
  onInputSubmit?: (input: DashboardInput) => void;
}) {
  const [input, setInput] = useState(initialInput);
  const [state, setState] = useState<DashboardState>({ status: 'loading' });
  const initial = useRef(initialInput);
  const controller = useRef<ReturnType<typeof createDashboardController> | null>(null);
  useEffect(() => {
    const active = createDashboardController(generate, setState);
    controller.current = active;
    void active.load(initial.current);
    return () => { active.dispose(); controller.current = null; };
  }, [generate]);

  function edit(key: keyof DashboardInput, value: string) {
    controller.current?.invalidate();
    setInput((previous) => ({ ...previous, [key]: value }));
  }
  return (
    <section className="space-y-5" aria-label="Dashboard Daily v2">
      <header><h2 className="text-2xl font-semibold">Trésorerie — relevés validés Daily v2</h2><p className="text-sm text-slate-600">Consultation uniquement. Aucun dépôt, promotion ou ouverture des écritures depuis ce dashboard.</p></header>
      <form className="rounded-lg border p-4 space-y-4" onSubmit={(event) => { event.preventDefault(); onInputSubmit?.({ ...input }); void controller.current?.load(input); }}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">Situation au (UTC par défaut)<Input required type="date" value={input.asOfDate} onChange={(event) => edit('asOfDate', event.target.value)} /></label>
          <label className="text-sm">Flux observés depuis le<Input required type="date" value={input.flowStartDate} onChange={(event) => edit('flowStartDate', event.target.value)} /></label>
          <label className="text-sm">Banque (optionnelle)<Input maxLength={12} placeholder="Toutes les banques observées" value={input.bank ?? ''} onChange={(event) => edit('bank', event.target.value.toUpperCase())} /></label>
          <label className="text-sm">Devise (optionnelle)<Input maxLength={12} placeholder="Toutes, sans conversion" value={input.currency ?? ''} onChange={(event) => edit('currency', event.target.value.toUpperCase())} /></label>
        </div>
        <Button type="submit" disabled={state.status === 'loading'}>Actualiser la vue Daily v2</Button>
        <a className="ml-4 text-sm underline" href="/daily-statements">Ouvrir le détail et le reporting Daily v2</a>
        <p className="text-xs text-slate-600">Une revérification des droits peut rétablir les derniers filtres soumis ; une saisie non soumise ne déclenche jamais cette lecture.</p>
      </form>
      <DailyV2DashboardView state={state} />
    </section>
  );
}
