"use client";

import { useState, useEffect } from "react";
import WeekCalendar from "@/components/WeekCalendar";

export default function Home() {
  const [userName, setUserName] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("whentoplan_user");
    if (stored) setUserName(stored);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = inputValue.trim();
    if (!name) return;
    localStorage.setItem("whentoplan_user", name);
    setUserName(name);
  }

  function handleChangeName() {
    localStorage.removeItem("whentoplan_user");
    setUserName(null);
    setInputValue("");
  }

  if (!mounted) return null;

  if (!userName) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm mx-4">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">🅿️</div>
            <h1 className="text-2xl font-bold text-slate-800">PapicinosPlanning</h1>
            <p className="text-slate-500 text-sm mt-1">
              Find the best time for your group
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Your name
              </label>
              <input
                id="name"
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="e.g. Alice"
                maxLength={40}
                autoFocus
                className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              type="submit"
              disabled={!inputValue.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-2.5 transition-colors"
            >
              Enter planner
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xl">🅿️</span>
          <h1 className="text-lg font-bold text-slate-800">PapicinosPlanning</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">
            Logged in as{" "}
            <span className="font-semibold text-slate-700">{userName}</span>
          </span>
          <button
            onClick={handleChangeName}
            className="text-xs text-blue-600 hover:text-blue-800 underline"
          >
            Change
          </button>
        </div>
      </header>
      <WeekCalendar currentUser={userName} />
    </main>
  );
}
