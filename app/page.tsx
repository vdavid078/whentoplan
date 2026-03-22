"use client";

import { useState, useEffect } from "react";
import WeekCalendar from "@/components/WeekCalendar";

const MEMBERS = ["David", "Jakob", "Julius", "Felix (J)", "Felix (H)"];

export default function Home() {
  const [userName, setUserName]     = useState<string | null>(null);
  const [selected, setSelected]     = useState<string>("");
  const [step, setStep]             = useState<"pick" | "agb">("pick");
  const [agreed, setAgreed]         = useState(false);
  const [mounted, setMounted]       = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("whentoplan_user");
    if (stored) setUserName(stored);
  }, []);

  function handlePickSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setStep("agb");
  }

  function handleAgbSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) return;
    localStorage.setItem("whentoplan_user", selected);
    setUserName(selected);
  }

  function handleChangeName() {
    localStorage.removeItem("whentoplan_user");
    setUserName(null);
    setSelected("");
    setAgreed(false);
    setStep("pick");
  }

  if (!mounted) return null;

  if (!userName) {
    return (
      <main className="min-h-screen flex items-center justify-center relative">
        <div className="fixed inset-0 bg-cover bg-center -z-10" style={{ backgroundImage: "url('/papicinos.jpg')" }} />
        <div className="fixed inset-0 bg-white/60 -z-10" />

        {step === "pick" ? (
          /* ── Step 1: Name auswählen ── */
          <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm mx-4">
            <div className="text-center mb-6">
              <div className="text-4xl mb-2">🅿️</div>
              <h1 className="text-2xl font-bold text-slate-800">PapicinosPlanning</h1>
              <p className="text-slate-500 text-sm mt-1">Findet den besten Termin für eure Gruppe</p>
            </div>
            <form onSubmit={handlePickSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Wer bist du?</label>
                <div className="flex flex-col gap-2">
                  {MEMBERS.map(name => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setSelected(name)}
                      className={`w-full text-left px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                        selected === name
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {selected === name ? "✓ " : ""}{name}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="submit"
                disabled={!selected}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-2.5 transition-colors"
              >
                Weiter →
              </button>
            </form>
          </div>
        ) : (
          /* ── Step 2: AGB ── */
          <div className="bg-white rounded-2xl shadow-lg w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100">
              <div className="text-center">
                <div className="text-3xl mb-1">📜</div>
                <h2 className="text-lg font-bold text-slate-800">Nutzungsbedingungen</h2>
                <p className="text-xs text-slate-400 mt-0.5">PapicinosPlanning GmbH & Co. Freundeskreis KG · Version 4.20</p>
              </div>
            </div>

            <div className="px-6 py-4 max-h-64 overflow-y-auto text-xs text-slate-500 space-y-3 leading-relaxed border-b border-slate-100 bg-slate-50/50">
              <p><span className="font-bold text-slate-700">§ 1 – Geltungsbereich</span><br />
              Diese Nutzungsbedingungen gelten für alle natürlichen Personen, die sich als {selected} identifizieren und den Dienst PapicinosPlanning (nachfolgend „die App", „dieses Wunderwerk" oder „das Ding") nutzen möchten. Mit dem Klick auf „Ich stimme zu" erkennt der Nutzer an, dass er diese Bedingungen gelesen, verstanden und innerlich geseufzt hat.</p>

              <p><span className="font-bold text-slate-700">§ 2 – Zweck der Plattform</span><br />
              Die App dient ausschließlich der Koordination gemeinsamer Freizeitaktivitäten im Freundeskreis. Eine kommerzielle Nutzung ist untersagt. Eine romantische Nutzung ist ebenfalls untersagt. Insbesondere ist es strengstens verboten, die App als Ausrede zu verwenden, um Verabredungen zu verschieben, weil „man ja warten muss bis alle können".</p>

              <p><span className="font-bold text-slate-700">§ 3 – Mitnahmeverbot (WICHTIG. SEHR WICHTIG. BITTE LESEN.)</span><br />
              Der Nutzer bestätigt hiermit feierlich, eidlich und mit vollständiger geistiger Zurechnungsfähigkeit, dass er zu keinem durch diese App geplanten Treffen seine Freundin, Partnerin, Begleiterin, Verlobte, Ehefrau oder sonstige romantisch assoziierte Begleitperson mitbringen wird. Dies gilt unabhängig davon, ob sie „nur kurz vorbeischaut", „eh bald geht" oder „wirklich total entspannt ist und niemanden stört". Sie stört. Wir wissen es. Du weißt es. Sie weiß es. § 3 weiß es.</p>

              <p><span className="font-bold text-slate-700">§ 4 – Haftungsausschluss</span><br />
              PapicinosPlanning übernimmt keine Haftung für: schlechtes Wetter, ausgebuchte Restaurants, Verfügbarkeitslücken durch spontane Beziehungsurlaube, Felix (H) der doch nicht kann, Felix (J) der auch nicht kann, sowie jegliche Form von Gruppenentscheidungsparalyse.</p>

              <p><span className="font-bold text-slate-700">§ 5 – Salvatorische Klausel</span><br />
              Sollte eine Bestimmung dieser AGB unwirksam sein, bleiben die übrigen Bestimmungen gültig. Sollten alle Bestimmungen unwirksam sein, bleibt § 3 trotzdem in Kraft. Immer.</p>
            </div>

            <form onSubmit={handleAgbSubmit} className="px-6 py-4 space-y-4">
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={e => setAgreed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 shrink-0 accent-blue-600 cursor-pointer"
                />
                <span className="text-xs text-slate-600 leading-relaxed group-hover:text-slate-800 transition-colors">
                  Ich, <span className="font-bold text-slate-800">{selected}</span>, habe die Nutzungsbedingungen gelesen und stimme ihnen zu – insbesondere § 3. Ich werde niemanden mitbringen. Niemanden. Ich schwöre es beim Papicinos.
                </span>
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep("pick")}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-500 hover:bg-slate-50 transition-colors"
                >
                  ← Zurück
                </button>
                <button
                  type="submit"
                  disabled={!agreed}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-2.5 text-sm transition-colors"
                >
                  Zustimmen & Weiter
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="min-h-screen relative">
      <div className="fixed inset-0 bg-cover bg-center -z-10" style={{ backgroundImage: "url('/papicinos.jpg')" }} />
      <div className="fixed inset-0 bg-white/70 -z-10" />

      <header className="bg-white/85 backdrop-blur border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xl">🅿️</span>
          <h1 className="text-base font-bold text-slate-800">PapicinosPlanning</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-100 rounded-full px-3 py-1">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-xs font-semibold text-slate-700">{userName}</span>
          </div>
          <button onClick={handleChangeName} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
            ✕
          </button>
        </div>
      </header>
      <WeekCalendar currentUser={userName} />
    </main>
  );
}
