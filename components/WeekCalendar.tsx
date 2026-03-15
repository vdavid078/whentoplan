"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, type Availability } from "@/lib/supabase";

const HOURS = Array.from({ length: 15 }, (_, i) => i + 8); // 8–22

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // Monday as start
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function slotKey(date: Date, hour: number): string {
  return `${formatDate(date)}_${String(hour).padStart(2, "0")}`;
}

function parseSlotKey(key: string): { date: string; hour: number } {
  const [date, hourStr] = key.split("_");
  return { date, hour: parseInt(hourStr, 10) };
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function heatmapColor(count: number, maxCount: number, isCurrentUser: boolean) {
  const base =
    count === 0
      ? "bg-slate-100"
      : count === 1
      ? "bg-green-100"
      : count === 2
      ? "bg-green-300"
      : count < 5
      ? "bg-green-500"
      : "bg-green-700";

  const outline = isCurrentUser
    ? "ring-2 ring-blue-500 ring-inset"
    : "";

  return `${base} ${outline}`;
}

function generateICS(slot: string): string {
  const { date, hour } = parseSlotKey(slot);
  const [year, month, day] = date.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dtStart = `${year}${pad(month)}${pad(day)}T${pad(hour)}0000`;
  const dtEnd = `${year}${pad(month)}${pad(day)}T${pad(hour + 1)}0000`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WhenToPlan//EN",
    "BEGIN:VEVENT",
    `UID:whentoplan-${slot}@whentoplan`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    "SUMMARY:Group Meeting (WhenToPlan)",
    "DESCRIPTION:Best available slot from WhenToPlan",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function downloadICS(slot: string) {
  const content = generateICS(slot);
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `whentoplan-${slot}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WeekCalendar({
  currentUser,
}: {
  currentUser: string;
}) {
  const [weekStart, setWeekStart] = useState<Date>(() =>
    getWeekStart(new Date())
  );

  // All availabilities from DB: slot_key → Set<user_name>
  const [allSlots, setAllSlots] = useState<Map<string, Set<string>>>(
    new Map()
  );

  // Current user's own selected slots (local optimistic + server confirmed)
  const [mySlots, setMySlots] = useState<Set<string>>(new Set());

  // View mode: "heatmap" | "user:<name>"
  const [viewUser, setViewUser] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<string[]>([]);

  // Drag state
  const dragging = useRef(false);
  const dragMode = useRef<"add" | "remove">("add");
  const dragStartSlot = useRef<string | null>(null);
  const pendingToggle = useRef<Set<string>>(new Set());

  // Load all data
  const loadAll = useCallback(async () => {
    const { data, error } = await supabase
      .from("availabilities")
      .select("user_name, slot_key");
    if (error) {
      console.error("Load error:", error);
      return;
    }

    const map = new Map<string, Set<string>>();
    const users = new Set<string>();
    for (const row of data as Pick<Availability, "user_name" | "slot_key">[]) {
      users.add(row.user_name);
      if (!map.has(row.slot_key)) map.set(row.slot_key, new Set());
      map.get(row.slot_key)!.add(row.user_name);
    }

    setAllSlots(map);
    setAllUsers(Array.from(users).sort());

    // Derive current user's slots
    const mine = new Set<string>();
    map.forEach((usersInSlot, key) => {
      if (usersInSlot.has(currentUser)) mine.add(key);
    });
    setMySlots(mine);
  }, [currentUser]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("availabilities-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "availabilities" },
        () => {
          loadAll();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadAll]);

  // ── Slot toggle logic ────────────────────────────────────────────────────

  async function addSlot(key: string) {
    setMySlots((prev) => new Set([...prev, key]));
    setAllSlots((prev) => {
      const next = new Map(prev);
      if (!next.has(key)) next.set(key, new Set());
      next.get(key)!.add(currentUser);
      return next;
    });
    await supabase
      .from("availabilities")
      .upsert({ user_name: currentUser, slot_key: key });
  }

  async function removeSlot(key: string) {
    setMySlots((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setAllSlots((prev) => {
      const next = new Map(prev);
      next.get(key)?.delete(currentUser);
      return next;
    });
    await supabase
      .from("availabilities")
      .delete()
      .eq("user_name", currentUser)
      .eq("slot_key", key);
  }

  // ── Drag handlers ────────────────────────────────────────────────────────

  function handleMouseDown(key: string) {
    dragging.current = true;
    const isSelected = mySlots.has(key);
    dragMode.current = isSelected ? "remove" : "add";
    pendingToggle.current = new Set([key]);
    dragStartSlot.current = key;

    if (dragMode.current === "add") addSlot(key);
    else removeSlot(key);
  }

  function handleMouseEnter(key: string) {
    if (!dragging.current) return;
    if (pendingToggle.current.has(key)) return;
    pendingToggle.current.add(key);

    if (dragMode.current === "add") addSlot(key);
    else removeSlot(key);
  }

  function handleMouseUp() {
    dragging.current = false;
    pendingToggle.current.clear();
  }

  // ── Best slot ────────────────────────────────────────────────────────────

  const bestSlot = (() => {
    let best: string | null = null;
    let bestCount = 0;
    allSlots.forEach((users, key) => {
      if (users.size > bestCount) {
        bestCount = users.size;
        best = key;
      }
    });
    return best ? { key: best, count: bestCount } : null;
  })();

  // ── Week days ────────────────────────────────────────────────────────────

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const today = formatDate(new Date());

  // ── Max count for color scaling ──────────────────────────────────────────

  let maxCount = 1;
  allSlots.forEach((users) => {
    if (users.size > maxCount) maxCount = users.size;
  });

  // ── Render ───────────────────────────────────────────────────────────────

  const viewingUser = viewUser;

  return (
    <div
      className="p-4 max-w-6xl mx-auto"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* ── Controls ── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Week navigation */}
        <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-3 py-2 shadow-sm">
          <button
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            className="text-slate-500 hover:text-slate-800 font-bold text-lg px-1"
            aria-label="Previous week"
          >
            ‹
          </button>
          <span className="text-sm font-medium text-slate-700 min-w-[150px] text-center">
            {weekStart.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}{" "}
            –{" "}
            {addDays(weekStart, 6).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <button
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            className="text-slate-500 hover:text-slate-800 font-bold text-lg px-1"
            aria-label="Next week"
          >
            ›
          </button>
          <button
            onClick={() => setWeekStart(getWeekStart(new Date()))}
            className="text-xs text-blue-600 hover:underline ml-1"
          >
            Today
          </button>
        </div>

        {/* User view toggle */}
        <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-3 py-2 shadow-sm flex-wrap">
          <span className="text-xs text-slate-500 font-medium">View:</span>
          <button
            onClick={() => setViewUser(null)}
            className={`text-xs px-2 py-1 rounded-md font-medium transition-colors ${
              viewingUser === null
                ? "bg-blue-600 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Everyone
          </button>
          {allUsers.map((u) => (
            <button
              key={u}
              onClick={() => setViewUser(viewingUser === u ? null : u)}
              className={`text-xs px-2 py-1 rounded-md font-medium transition-colors ${
                viewingUser === u
                  ? "bg-purple-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      {/* ── Best slot banner ── */}
      {bestSlot && (
        <BestSlotBanner slot={bestSlot.key} count={bestSlot.count} />
      )}

      {/* ── Legend ── */}
      <div className="flex items-center gap-3 mb-3 text-xs text-slate-500">
        <span>Availability:</span>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-slate-100 border border-slate-200" />
          <span>0</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-green-100 border border-slate-200" />
          <span>1</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-green-300 border border-slate-200" />
          <span>2</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-green-500 border border-slate-200" />
          <span>3–4</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-green-700 border border-slate-200" />
          <span>5+</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-blue-100 ring-2 ring-blue-500 ring-inset border border-slate-200" />
          <span>Your slot</span>
        </div>
      </div>

      {/* ── Calendar grid ── */}
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden no-select"
        style={{ userSelect: "none" }}
      >
        {/* Header row */}
        <div className="grid" style={{ gridTemplateColumns: "52px repeat(7, 1fr)" }}>
          <div className="border-b border-r border-slate-200 bg-slate-50" />
          {weekDays.map((day, i) => {
            const isToday = formatDate(day) === today;
            return (
              <div
                key={i}
                className={`border-b border-r last:border-r-0 border-slate-200 py-2 text-center ${
                  isToday ? "bg-blue-50" : "bg-slate-50"
                }`}
              >
                <div
                  className={`text-xs font-medium ${
                    isToday ? "text-blue-600" : "text-slate-500"
                  }`}
                >
                  {WEEKDAY_LABELS[i]}
                </div>
                <div
                  className={`text-sm font-bold ${
                    isToday ? "text-blue-700" : "text-slate-700"
                  }`}
                >
                  {day.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Time rows */}
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="grid"
            style={{ gridTemplateColumns: "52px repeat(7, 1fr)" }}
          >
            {/* Hour label */}
            <div className="border-b border-r border-slate-100 bg-slate-50 flex items-center justify-end pr-2">
              <span className="text-xs text-slate-400 font-mono">
                {String(hour).padStart(2, "0")}:00
              </span>
            </div>
            {/* Day cells */}
            {weekDays.map((day, di) => {
              const key = slotKey(day, hour);
              const usersInSlot = allSlots.get(key) ?? new Set<string>();
              const count = usersInSlot.size;
              const isMine = mySlots.has(key);
              const isBest = bestSlot?.key === key;

              // In user-view mode, show that user's slots differently
              let cellClass = "";
              if (viewingUser) {
                const userHasSlot = usersInSlot.has(viewingUser);
                cellClass = userHasSlot
                  ? viewingUser === currentUser
                    ? "bg-blue-200 ring-2 ring-blue-500 ring-inset"
                    : "bg-purple-200"
                  : "bg-slate-50";
              } else {
                cellClass = heatmapColor(count, maxCount, isMine);
              }

              const isToday = formatDate(day) === today;

              return (
                <div
                  key={di}
                  title={
                    count > 0
                      ? `${count} available: ${Array.from(usersInSlot).join(", ")}`
                      : "No one available"
                  }
                  className={`border-b border-r last:border-r-0 border-slate-100 h-8 cursor-pointer transition-all relative ${cellClass} ${
                    isToday ? "border-l border-l-blue-200" : ""
                  } ${isBest && !viewingUser ? "ring-1 ring-yellow-400" : ""}`}
                  onMouseDown={() => handleMouseDown(key)}
                  onMouseEnter={() => handleMouseEnter(key)}
                >
                  {isBest && !viewingUser && count > 0 && (
                    <span className="absolute top-0 right-0 text-[9px] leading-none bg-yellow-400 text-yellow-900 px-0.5 rounded-bl font-bold">
                      ★
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-400 mt-3 text-center">
        Click or drag to toggle your availability · Hover a slot to see who&apos;s available
      </p>
    </div>
  );
}

// ─── Best Slot Banner ─────────────────────────────────────────────────────────

function BestSlotBanner({ slot, count }: { slot: string; count: number }) {
  const { date, hour } = parseSlotKey(slot);
  const dateObj = new Date(`${date}T00:00:00`);
  const dayLabel = dateObj.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="mb-4 bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-yellow-500 text-lg">★</span>
        <div>
          <p className="text-sm font-semibold text-yellow-900">
            Best slot — {dayLabel},{" "}
            {String(hour).padStart(2, "0")}:00–
            {String(hour + 1).padStart(2, "0")}:00
          </p>
          <p className="text-xs text-yellow-700">
            {count} {count === 1 ? "person" : "people"} available
          </p>
        </div>
      </div>
      <button
        onClick={() => downloadICS(slot)}
        className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-semibold text-xs px-3 py-1.5 rounded-lg transition-colors"
      >
        <span>⬇</span> Export .ics
      </button>
    </div>
  );
}
